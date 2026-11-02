import { Box3, Euler, Object3D, Quaternion, Vector3 } from "three";
import type { CargoRegistry } from "@/domain/cargo/CargoRegistry";
import {
  SIM_RECORDING_VERSION, type BoxParentKind, type PalletCarrierKind, type Quat, type SimRecording, type Vec3,
} from "@/domain/recording/simRecording";

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const vec = (v: Vector3): Vec3 => [r3(v.x), r3(v.y), r3(v.z)];
const quat = (q: Quaternion): Quat => [r3(q.x), r3(q.y), r3(q.z), r3(q.w)];

export type SimRecorderMeta = { template: string; seed: number; seconds: number };
export type SimRecorderHooks = {
  /** Scene equipment kind by id (e.g. "amr", "rail", "transfer", "robot"); resolves carriers tagged with userData.sceneId. */
  objectKind?: (id: string) => string | undefined;
  /** Rail / transfer id currently holding this pallet group (rail items sit on the world root), else null. */
  railOf?: (group: Object3D) => string | null;
  /** Live pallet group of a pallet station (covers stations mounted on shuttle carriers outside the scanned root). */
  stationGroup?: (stationId: string) => Object3D | undefined;
};

/**
 * Polling recorder (see simRecording.ts). Call frame(t) after every simulation frame and suction(...) from
 * SuctionRobotController.onSuction. Reads the scene and the CargoRegistry only; changes nothing.
 */
export class SimRecorder {
  readonly data: SimRecording;
  private readonly scene: Object3D;
  private readonly cargo: CargoRegistry;
  private readonly hooks: SimRecorderHooks;
  private readonly boxes = new Map<string, Object3D>();
  private readonly pallets = new Map<string, Object3D>();
  private readonly groupPallet = new Map<string, string>(); // group uuid -> pallet id (learned)
  private readonly parentOf = new Map<string, string>();
  private readonly palletState = new Map<string, string>();
  private readonly palletCarrier = new Map<string, string>();
  private readonly lastPose = new Map<string, [Vec3, number]>();
  private readonly firstSeen = new Map<string, number>();
  private inbound = 0;
  private nextScan = 0;
  private nextKey = 0;
  private readonly p = new Vector3();
  private readonly q = new Quaternion();
  private readonly e = new Euler();

  constructor(scene: Object3D, cargo: CargoRegistry, meta: SimRecorderMeta, hooks: SimRecorderHooks = {}) {
    this.scene = scene; this.cargo = cargo; this.hooks = hooks;
    this.data = { version: SIM_RECORDING_VERSION, ...meta, suction: [], contacts: [], boxParents: [], boxKeyframes: [], pallets: [], palletParents: [] };
  }
  /** Tag a robot mount: boxes anywhere under it record as parentKind "arm" with this id. */
  markArm(holder: Object3D, robotId: string) { holder.userData.recordArm = robotId; }

  suction(t: number, robotId: string, on: boolean, box: Object3D, tool: Vector3) {
    const id = (box.userData.boxId as string | undefined) ?? null;
    this.data.suction.push([r3(t), robotId, on, id]);
    if (on) {
      const b = new Box3().setFromObject(box);
      const top = new Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
      this.data.contacts.push({ t: r3(t), robotId, boxId: id, tool: vec(tool), boxTop: vec(top), distance: r3(tool.distanceTo(top)), dy: r3(tool.y - top.y) });
    }
    if (id) { this.boxes.set(id, box); this.check(t, id, box); }
  }

  /** Loose pallet groups carry userData.palletTurn; a station's live pallet group carries the station's sceneId. */
  private isPallet(o: Object3D): boolean {
    if (o.userData.palletTurn !== undefined) return true;
    const sid = o.userData.sceneId as string | undefined;
    return !!sid && this.hooks.objectKind?.(sid) === "pallet";
  }
  /** Pallet id of a pallet group: explicit tags, learned mapping, station's current pallet, or its boxes' pallet. */
  private palletIdOf(g: Object3D): string | null {
    let id: string | null = ((g.userData.boxId ?? g.userData.rackPallet) as string | undefined) ?? null;
    if (!id && typeof g.userData.sceneId === "string") id = this.cargo.currentPallet(g.userData.sceneId)?.id ?? null; // station's live pallet
    if (!id) id = this.groupPallet.get(g.uuid) ?? null;
    if (!id) for (const c of g.children) {
      const b = c.userData.boxId as string | undefined;
      const pid = b ? this.cargo.box(b)?.palletId : undefined;
      if (pid) { id = pid; break; }
    }
    // Inbound / loose pallets have no CargoRegistry record: give the group a stable synthetic id (IN-0001...).
    if (!id && g.userData.palletTurn !== undefined) id = `IN-${String(++this.inbound).padStart(4, "0")}`;
    if (id) this.groupPallet.set(g.uuid, id);
    return id;
  }
  /** Carrier of an object from its ancestors: robot mount, AMR/forklift carrier, rail item, rack/dock by sceneId. */
  private carrierOf(o: Object3D): [PalletCarrierKind, string] | null {
    const own = o.userData.sceneId as string | undefined;
    if (own && this.isPallet(o) && o.userData.palletTurn === undefined) return ["station", own];
    for (let n = o.parent; n; n = n.parent) {
      if (n.userData.recordArm) return ["arm", n.userData.recordArm as string];
      const sid = n.userData.sceneId as string | undefined;
      if (sid && !this.isPallet(n)) {
        const k = this.hooks.objectKind?.(sid);
        if (k === "rail" || k === "transfer") return ["rail", sid];
        if (k === "robot") return ["arm", sid];
        if (k === "rack" || k === "dock" || k === "pallet" || k === "conveyor") return [k === "pallet" ? "station" : k, sid];
        return ["amr", sid];
      }
    }
    const rail = this.hooks.railOf?.(o);
    return rail ? ["rail", rail] : null;
  }

  private classify(id: string, box: Object3D): [BoxParentKind, string | null] | null {
    for (let n = box.parent; n; n = n.parent) {
      if (n.userData.recordArm) return ["arm", n.userData.recordArm as string];
      if (this.isPallet(n)) { const pid = this.palletIdOf(n) ?? this.cargo.box(id)?.palletId ?? null; return pid ? ["pallet", pid] : null; }
    }
    const rec = this.cargo.box(id);
    if (!rec) return ["world", null];
    switch (rec.state) {
      case "conveyor": case "passed": return ["conveyor", rec.holder];
      case "robot": return ["arm", rec.holder];
      case "amr": return [/rail/i.test(rec.holder ?? "") ? "rail" : "amr", rec.holder];
      case "rack": return ["rack", rec.holder];
      case "dock": case "shipped": return ["dock", rec.holder];
      case "pallet": return rec.palletId ? ["pallet", rec.palletId] : null;
    }
  }
  private check(t: number, id: string, box: Object3D) {
    const c = box.parent ? this.classify(id, box) : (["none", null] as [BoxParentKind, null]);
    if (!c) return; // pallet id not resolvable yet: retry next frame instead of emitting a null parent
    const [kind, parentId] = c;
    const key = `${kind}|${parentId}|${box.parent?.uuid ?? ""}`;
    if (this.parentOf.get(id) === key) return;
    this.parentOf.set(id, key);
    this.data.boxParents.push([r3(t), id, kind, parentId, vec(box.position), quat(box.quaternion)]);
    if (kind === "none") this.boxes.delete(id);
  }
  private scan() {
    this.scene.traverse((o) => {
      if (this.isPallet(o)) { const pid = this.palletIdOf(o); if (pid) this.pallets.set(pid, o); return; }
      const id = o.userData.boxId as string | undefined;
      if (id) this.boxes.set(id, o);
    });
  }
  /** World position + yaw of a pallet group (last known pose if it left the scene). */
  private palletPose(id: string): [Vec3 | null, number | null] {
    let g = this.pallets.get(id);
    if (!g?.parent || this.palletIdOf(g) !== id) {
      const rec = this.cargo.pallets.get(id), sg = rec && rec.state === "loading" ? this.hooks.stationGroup?.(rec.stationId) : undefined;
      if (sg && this.palletIdOf(sg) === id) { g = sg; this.pallets.set(id, sg); }
    }
    if (g?.parent && this.palletIdOf(g) === id) {
      g.updateWorldMatrix(true, false);
      g.getWorldPosition(this.p); g.getWorldQuaternion(this.q);
      const pose: [Vec3, number] = [vec(this.p), r3(this.e.setFromQuaternion(this.q, "YXZ").y)];
      this.lastPose.set(id, pose);
      return pose;
    }
    return this.lastPose.get(id) ?? [null, null];
  }

  frame(t: number) {
    if (t >= this.nextScan) { this.scan(); this.nextScan = t + 0.5; }
    for (const [id, box] of this.boxes) this.check(t, id, box);
    const ev = this.data.pallets, seen = new Set<string>(), tick = t >= this.nextKey;
    for (const rec of this.cargo.pallets.values()) {
      seen.add(rec.id);
      const was = this.palletState.get(rec.id);
      const [pos, yaw] = this.palletPose(rec.id);
      if (!this.firstSeen.has(rec.id)) this.firstSeen.set(rec.id, t);
      // Hold the create until the group is found by a scan (<= 5 s), so it carries a pose.
      if (was === undefined && !pos && t - this.firstSeen.get(rec.id)! < 5) continue;
      const g = this.pallets.get(rec.id), carrier = g?.parent ? this.carrierOf(g) : null;
      const ck = carrier?.[0] ?? null, cid = carrier?.[1] ?? null;
      if (was === undefined) ev.push([r3(t), rec.id, "create", rec.stationId, pos, yaw, ck, cid]);
      else if (was !== rec.state) ev.push([r3(t), rec.id, rec.state === "shipped" ? "ship" : "move", rec.state, pos, yaw, ck, cid]);
      this.palletState.set(rec.id, rec.state);
      if (!g?.parent || rec.state === "shipped") continue;
      const key = `${ck}|${cid}|${g.parent.uuid}`;
      if (this.palletCarrier.get(rec.id) !== key) {
        const first = !this.palletCarrier.has(rec.id);
        this.palletCarrier.set(rec.id, key);
        this.data.palletParents?.push([r3(t), rec.id, ck ?? "world", cid]);
        if (!first) ev.push([r3(t), rec.id, "move", ck ? `${ck}:${cid}` : "world", pos, yaw, ck, cid]);
      } else if (tick && (ck === "amr" || ck === "rail")) ev.push([r3(t), rec.id, "move", `${ck}:${cid}`, pos, yaw, ck, cid]);
    }
    for (const [id, state] of this.palletState) if (!seen.has(id)) {
      const [pos, yaw] = this.palletPose(id);
      if (state !== "shipped") ev.push([r3(t), id, "ship", "retired", pos, yaw, null, null]);
      this.palletState.delete(id);
    }
    if (tick) {
      const boxes: [string, number, number, number][] = [];
      for (const [id, box] of this.boxes) if (box.parent) { const w = box.getWorldPosition(this.p); boxes.push([id, r3(w.x), r3(w.y), r3(w.z)]); }
      this.data.boxKeyframes.push({ t: r3(t), boxes });
      this.nextKey = Math.floor(t) + 1;
    }
  }
}
