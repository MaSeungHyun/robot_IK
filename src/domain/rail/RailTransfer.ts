import { Group, Vector3 } from "three";
import { RAIL_CONFIG, TRANSFER_CONFIG } from "@/constants/railTransfer";
import { STREAM_CONFIG } from "@/constants/simulation";
import type { SceneEquipment } from "@/types/layout";

/**
 * Pallet distribution rail (rail_condition) + Transfer_Forklift lifts at its ends.
 *
 * An AMR rolls an inbound pallet onto the rail centre; the rail sends each centre pallet to one free half (alternating
 * sides) where it waits on the end stopper until that end's transfer lift is ready, then rolls onto the lift forks.
 * Every slot holds at most one pallet and a slot only takes a pallet once the previous one is clear, so pallets never
 * collide; while the centre is occupied (or a side pallet is still near it) the rail accepts nothing (AMR waits).
 *
 * Transfer lift: ready → receiving (entry stopper down) → holding (robot depalletizes) → lowering (forks run out, then
 * down to the floor; vertical only) → waitPick (the linked forklift takes the empty pallet) → returning (forks rise)
 * → ready.
 */
export type RailItem = { group: Group; boxes: { id: string }[] };

type Slot = { item: RailItem; s: number; lateral: number; target: number; phase: "deposit" | "move" | "wait"; t: number; from?: Vector3 };
type TransferPhase = "ready" | "receiving" | "holding" | "lowering" | "waitPick" | "returning";

export type TransferUnit = {
  object: SceneEquipment;
  rail: RailUnit;
  side: -1 | 1;
  /** TF pallet point in rail coordinates (along / lateral). */
  s: number;
  lateral: number;
  phase: TransferPhase;
  t: number;
  item: RailItem | null;
  /** Fork stroke 0..1 (down, vertical only); stoppers 1 = raised. */
  down: number;
  entry: number;
  waitingReason: string | null;
};

export type RailUnit = {
  object: SceneEquipment;
  centre: Slot | null;
  /** Per-side queue (front = index 0, nearest the lift), at most RAIL_CONFIG.slotsPerSide pallets spaced by a pallet length. */
  halves: Record<-1 | 1, Slot[]>;
  /** Highest queue length seen per side, and frames where two queued pallets overlapped (must stay 0). */
  maxOccupancy: Record<-1 | 1, number>;
  overlaps: number;
  transfers: Partial<Record<-1 | 1, TransferUnit>>;
  next: -1 | 1;
  /** Pallets rolled onto this rail (KPI / tests); overruns = deposits while the centre was not clear (must stay 0). */
  received: number;
  overruns: number;
};

export type RailHooks = {
  /** Pallet resting on the raised TF forks: start depalletizing; call done() when the last box is gone. */
  held(tf: TransferUnit, item: RailItem, done: () => void): void;
  /** Empty pallet lowered on the floor: queue a forklift; call taken() once it has lifted it. */
  lowered(tf: TransferUnit, item: RailItem, taken: () => void): void;
};

const palletAlong = () => STREAM_CONFIG.palletWidth;
/** Queue slot i on a side: the front one against the end stopper, the rest one pallet length + gap further in. */
const slotPitch = () => palletAlong() + RAIL_CONFIG.slotGap;
const slotTarget = (side: -1 | 1, i: number) => side * (RAIL_CONFIG.halfLength - palletAlong() / 2 - RAIL_CONFIG.slotGap - i * slotPitch());
const smooth = (t: number) => t * t * (3 - 2 * t);

export class RailNetwork {
  readonly rails: RailUnit[];
  readonly transfers: TransferUnit[] = [];
  private readonly root: Group;
  private readonly hooks: RailHooks;
  constructor(rails: SceneEquipment[], transfers: SceneEquipment[], root: Group, hooks: RailHooks, linkedTransfers?: (railId: string) => readonly string[]) {
    this.root = root;
    this.hooks = hooks;
    this.rails = rails.map((object) => ({ object, centre: null, halves: { [-1]: [], [1]: [] }, maxOccupancy: { [-1]: 0, [1]: 0 }, overlaps: 0, transfers: {}, next: -1, received: 0, overruns: 0 }));
    const used = new Set<string>();
    for (const rail of this.rails)
      for (const side of [-1, 1] as const) {
        const end = this.world(rail, side * RAIL_CONFIG.halfLength, RAIL_CONFIG.point.z);
        let best: { tf: SceneEquipment; d: number; p: Vector3 } | null = null;
        // `distribute` links (rail → lift) restrict the pairing to the linked lifts, at any distance.
        const allowed = linkedTransfers?.(rail.object.id) ?? [];
        for (const tf of transfers) {
          if (used.has(tf.id) || (allowed.length && !allowed.includes(tf.id))) continue;
          const p = transferPoint(tf, 0);
          const d = Math.hypot(p.x - end.x, p.z - end.z);
          if ((allowed.length || d <= RAIL_CONFIG.transferSnap) && (!best || d < best.d)) best = { tf, d, p };
        }
        if (!best) continue;
        used.add(best.tf.id);
        const local = this.local(rail, best.p);
        const unit: TransferUnit = { object: best.tf, rail, side, s: local.s, lateral: local.lateral, phase: "ready", t: 0, item: null, down: 0, entry: 1, waitingReason: null };
        rail.transfers[side] = unit;
        this.transfers.push(unit);
      }
  }
  rail(id: string) {
    return this.rails.find((r) => r.object.id === id);
  }
  transfer(id: string) {
    return this.transfers.find((t) => t.object.id === id);
  }
  /** The centre is empty, no side pallet is still near it, and a side with a lift still has a free slot (else the AMR must not push). */
  canAccept(id: string) {
    const rail = this.rail(id);
    if (!rail || rail.centre) return false;
    if (!rail.transfers[-1] && !rail.transfers[1]) return false;
    if (!([-1, 1] as const).some((side) => rail.transfers[side] && rail.halves[side].length < RAIL_CONFIG.slotsPerSide)) return false;
    return ([-1, 1] as const).every((side) => { const q = rail.halves[side], last = q[q.length - 1]; return !last || Math.abs(last.s) >= RAIL_CONFIG.clearCentre; });
  }
  /** AMR deck → rail centre (the group is re-parented to the root, world pose kept). */
  deposit(id: string, item: RailItem) {
    const rail = this.rail(id)!;
    if (!this.canAccept(id)) rail.overruns++;
    this.root.attach(item.group);
    rail.centre = { item, s: 0, lateral: RAIL_CONFIG.point.z, target: 0, phase: "deposit", t: 0, from: item.group.position.clone() };
    rail.received++;
  }
  advance(dt: number) {
    for (const rail of this.rails) this.advanceRail(rail, dt);
    for (const tf of this.transfers) this.advanceTransfer(tf, dt);
  }
  private advanceRail(rail: RailUnit, dt: number) {
    const centre = rail.centre;
    if (centre?.phase === "deposit") {
      centre.t = Math.min(1, centre.t + dt / RAIL_CONFIG.depositSeconds);
      const to = this.world(rail, 0, RAIL_CONFIG.point.z, RAIL_CONFIG.point.y);
      const g = centre.item.group;
      g.position.lerpVectors(centre.from!, to, smooth(centre.t));
      // Ride up the entry ramp and settle back on the rollers (lift + pitch while the pallet centre crosses it).
      const ramp = RAIL_CONFIG.ramp, depth = STREAM_CONFIG.palletDepth, span = ramp.outerZ - ramp.innerZ + depth;
      const lateral = this.local(rail, g.position).lateral;
      const u = Math.min(1, Math.max(0, (ramp.outerZ + depth / 2 - lateral) / span));
      const inside = u > 0 && u < 1;
      g.position.y += inside ? ramp.rise * Math.sin(Math.PI * u) : 0;
      const pitch = inside ? Math.atan((ramp.rise * Math.PI / span) * Math.cos(Math.PI * u)) * Math.sign(lateral - RAIL_CONFIG.point.z) : 0;
      g.rotation.set(pitch, rail.object.yaw, 0, "YXZ");
      if (centre.t >= 1) centre.phase = "wait";
    }
    // Centre → a free half (prefer the alternating side; only sides that have a lift).
    if (centre?.phase === "wait") {
      const sides = ([rail.next, -rail.next] as (-1 | 1)[]).filter((side) => {
        const q = rail.halves[side], last = q[q.length - 1];
        return rail.transfers[side] && q.length < RAIL_CONFIG.slotsPerSide && (!last || Math.abs(last.s) >= slotPitch() - 1e-6);
      });
      const side = sides[0];
      if (side) {
        rail.halves[side].push({ ...centre, phase: "move", target: slotTarget(side, rail.halves[side].length) });
        rail.centre = null;
        rail.next = (-side) as -1 | 1;
      }
    }
    for (const side of [-1, 1] as const) {
      const q = rail.halves[side];
      rail.maxOccupancy[side] = Math.max(rail.maxOccupancy[side], q.length);
      // Followers close up to their slot but never nearer than one pitch behind the pallet ahead.
      for (let i = 1; i < q.length; i++) {
        const s = q[i];
        s.target = slotTarget(side, i);
        const bound = q[i - 1].s - side * slotPitch();
        const next = step(s.s, s.target, RAIL_CONFIG.speed * dt);
        s.s = side > 0 ? Math.min(next, Math.max(bound, s.s)) : Math.max(next, Math.min(bound, s.s));
        s.phase = s.s === s.target ? "wait" : "move";
        if (Math.abs(q[i - 1].s - s.s) < palletAlong() - 1e-3) rail.overlaps++;
        this.place(s.item.group, rail, s.s, s.lateral);
      }
      const slot = q[0];
      if (!slot) continue;
      const tf = rail.transfers[side]!;
      slot.target = slotTarget(side, 0);
      if (slot.phase === "move") {
        slot.s = step(slot.s, slot.target, RAIL_CONFIG.speed * dt);
        if (slot.s === slot.target) slot.phase = "wait";
      }
      // At the end stopper: hand over once the lift is ready (entry stopper lowers first).
      if (slot.phase === "wait" && tf.phase === "ready") {
        tf.phase = "receiving";
        tf.t = 0;
      }
      if (tf.phase === "receiving" && tf.entry <= 0 && slot.phase === "wait") {
        slot.s = step(slot.s, tf.s, RAIL_CONFIG.speed * dt);
        slot.lateral = step(slot.lateral, tf.lateral, RAIL_CONFIG.speed * dt * 0.5);
        if (slot.s === tf.s && slot.lateral === tf.lateral) {
          tf.item = slot.item;
          q.shift();
        }
      }
      if (q[0] === slot) this.place(slot.item.group, rail, slot.s, slot.lateral);
    }
  }
  private advanceTransfer(tf: TransferUnit, dt: number) {
    const stop = dt / TRANSFER_CONFIG.stopper.seconds;
    tf.t += dt;
    switch (tf.phase) {
      case "ready":
        tf.entry = Math.min(1, tf.entry + stop);
        tf.waitingReason = "팔레트 대기";
        break;
      case "receiving":
        tf.waitingReason = "팔레트 받는 중";
        if (!tf.item) tf.entry = Math.max(0, tf.entry - stop);
        else {
          tf.entry = Math.min(1, tf.entry + stop);
          if (tf.entry >= 1) {
            tf.phase = "holding";
            tf.t = 0;
            const item = tf.item;
            this.hooks.held(tf, item, () => {
              if (tf.item !== item) return;
              tf.phase = "lowering";
              tf.t = 0;
            });
          }
        }
        break;
      case "holding":
        tf.waitingReason = "로봇 하역 대기";
        break;
      case "lowering": {
        const f = Math.min(1, tf.t / TRANSFER_CONFIG.lowerSeconds);
        tf.down = smooth(f);
        tf.waitingReason = "빈 팔레트 내리는 중";
        if (f >= 1) {
          tf.phase = "waitPick";
          tf.t = 0;
          const item = tf.item!;
          this.hooks.lowered(tf, item, () => {
            if (tf.item !== item) return;
            tf.item = null;
            tf.phase = "returning";
            tf.t = 0;
          });
        }
        break;
      }
      case "waitPick":
        tf.waitingReason = "지게차 빈 팔레트 회수 대기";
        break;
      case "returning": {
        const f = Math.min(1, tf.t / TRANSFER_CONFIG.returnSeconds);
        tf.down = 1 - smooth(f);
        tf.waitingReason = "포크 상승 중";
        if (f >= 1) {
          tf.phase = "ready";
          tf.t = 0;
        }
        break;
      }
    }
    // The pallet rides the forks (not once the forklift has lifted it off).
    if (tf.item && tf.phase !== "receiving") {
      const p = transferPoint(tf.object, tf.down);
      tf.item.group.position.copy(p);
      tf.item.group.rotation.set(0, tf.rail.object.yaw, 0);
    }
  }
  /** Fork / stopper pose for rendering. */
  view(id: string) {
    const tf = this.transfer(id);
    return tf ? { down: tf.down, entry: tf.entry, side: tf.side, phase: tf.phase } : null;
  }
  /** Rail and lift bodies as wall-like segments for AMR / forklift routing. */
  obstacles() {
    const segs: { a: Vector3; b: Vector3; radius: number }[] = [];
    for (const rail of this.rails)
      segs.push({ a: this.world(rail, -RAIL_CONFIG.halfLength + RAIL_CONFIG.halfWidth, RAIL_CONFIG.centerZ), b: this.world(rail, RAIL_CONFIG.halfLength - RAIL_CONFIG.halfWidth, RAIL_CONFIG.centerZ), radius: RAIL_CONFIG.halfWidth });
    return segs;
  }
  private place(group: Group, rail: RailUnit, s: number, lateral: number) {
    group.position.copy(this.world(rail, s, lateral, RAIL_CONFIG.point.y));
    group.rotation.set(0, rail.object.yaw, 0);
  }
  private world(rail: RailUnit, s: number, lateral: number, y = 0) {
    return localToWorld(rail.object, s, lateral, y);
  }
  private local(rail: RailUnit, p: Vector3) {
    const o = rail.object, c = Math.cos(o.yaw), sn = Math.sin(o.yaw), dx = p.x - o.x, dz = p.z - o.z;
    // Inverse of localToWorld (rotation about +y by yaw).
    return { s: dx * c - dz * sn, lateral: dx * sn + dz * c };
  }
}

/** Equipment-local (x, y, z) → world, rotation about +y by yaw (three.js convention). */
export function localToWorld(o: { x: number; z: number; yaw: number }, x: number, z: number, y = 0) {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  return new Vector3(o.x + x * c + z * s, y, o.z - x * s + z * c);
}

/** TF pallet point at a fork stroke (down 0..1, vertical only). */
export function transferPoint(tf: { x: number; z: number; yaw: number }, down: number) {
  const p = TRANSFER_CONFIG.point;
  return localToWorld(tf, p.x, p.z, p.y - down * TRANSFER_CONFIG.downY);
}

/** Lift body segment (local z axis) for routing. */
export function transferObstacle(tf: { x: number; z: number; yaw: number }) {
  const f = TRANSFER_CONFIG.footprint, cx = (f.minX + f.maxX) / 2, r = (f.maxX - f.minX) / 2;
  return { a: localToWorld(tf, cx, f.minZ + r), b: localToWorld(tf, cx, f.maxZ - r), radius: r };
}

function step(value: number, target: number, max: number) {
  const d = target - value;
  return Math.abs(d) <= max ? target : value + Math.sign(d) * max;
}