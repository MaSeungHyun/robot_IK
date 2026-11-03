import { Group, Vector3 } from "three";
import { RAIL_CONFIG, TRANSFER_CONFIG } from "@/constants/railTransfer";
import { STREAM_CONFIG } from "@/constants/simulation";
import type { SceneEquipment } from "@/types/layout";
import { animatedPart, type AnimatedPart } from "@/domain/recording/animatedParts";

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
  /** Pallets rolled onto this rail (KPI / tests); overruns = refused deposit attempts (callers check canAccept first: must stay 0). */
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
/** Bottom height of the entry ramp at local z. The deck sits above the ramp foot, so the approach eases down onto the lip instead of stepping off it. */
function rampSurface(z: number, deckY: number) {
  const { outerZ, innerZ, rise } = RAIL_CONFIG.ramp, top = RAIL_CONFIG.point.y, foot = top - rise;
  if (z <= innerZ) return top;
  if (z < outerZ) return foot + rise * ((outerZ - z) / (outerZ - innerZ));
  const meet = outerZ + 0.55;
  if (z >= meet) return deckY;
  return deckY + (foot - deckY) * smooth((meet - z) / (meet - outerZ));
}
/** Pallet bottom on the ramp. Pitch is the slope between the two ends, so a short chamfer does not tip the whole pallet. */
function rampRide(lateral: number, deckY: number) {
  const half = STREAM_CONFIG.palletDepth / 2;
  const fore = rampSurface(lateral - half, deckY), aft = rampSurface(lateral + half, deckY);
  return { y: (fore + aft) / 2, pitch: Math.atan2(aft - fore, half * 2) };
}

/** Transfer_Forklift.glb: authored local y of the fork node (see TRANSFER_CONFIG.downY). */
const TRANSFER_FORK_REST_Y = 1.27529;

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
  /**
   * A side can take the next pallet only when its queue is empty and its lift is ready (empty, forks up): a lift still
   * holding a pallet (boxes left to depalletize), lowering it or waiting for the empty-pallet forklift blocks its side.
   * Pallets never stack up on the rail; the AMR keeps its pallet on the deck and waits instead.
   */
  private sideFree(rail: RailUnit, side: -1 | 1) {
    const tf = rail.transfers[side];
    return !!tf && tf.phase === "ready" && !tf.item && rail.halves[side].length === 0;
  }
  /** The centre is empty and a side with a ready lift has an empty queue (else the AMR must not push). */
  canAccept(id: string) {
    const rail = this.rail(id);
    if (!rail || rail.centre) return false;
    return ([-1, 1] as const).some((side) => this.sideFree(rail, side));
  }
  /** AMR deck → rail centre (the group is re-parented to the root, world pose kept). False = refused (the AMR waits). */
  deposit(id: string, item: RailItem): boolean {
    const rail = this.rail(id);
    if (!rail || !this.canAccept(id)) {
      if (rail) rail.overruns++;
      return false;
    }
    this.root.attach(item.group);
    rail.centre = { item, s: 0, lateral: RAIL_CONFIG.point.z, target: 0, phase: "deposit", t: 0, from: item.group.position.clone() };
    rail.received++;
    return true;
  }
  advance(dt: number) {
    for (const rail of this.rails) this.advanceRail(rail, dt);
    for (const tf of this.transfers) this.advanceTransfer(tf, dt);
  }
  private advanceRail(rail: RailUnit, dt: number) {
    const centre = rail.centre;
    if (centre?.phase === "deposit") {
      centre.t = Math.min(1, centre.t + dt / RAIL_CONFIG.depositSeconds);
      const g = centre.item.group;
      const from = this.local(rail, centre.from!);
      const u = smooth(centre.t);
      const lateral = from.lateral + (RAIL_CONFIG.point.z - from.lateral) * u;
      const ride = rampRide(lateral, centre.from!.y);
      g.position.copy(this.world(rail, from.s * (1 - u), lateral, ride.y));
      g.rotation.set(ride.pitch, rail.object.yaw, 0, "YXZ");
      if (centre.t >= 1) centre.phase = "wait";
    }
    // Centre → a free half (prefer the alternating side; only sides that have a lift).
    if (centre?.phase === "wait") {
      const sides = ([rail.next, -rail.next] as (-1 | 1)[]).filter((side) => {
        return this.sideFree(rail, side);
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
      // A follower that became the front (previous one rolled onto the lift) still has to run up to the end stopper:
      // it may be "wait" at its old inner slot, so move whenever it is short of the stopper (never pulled back off the lift).
      if (slot.phase === "move" || Math.abs(slot.s) < Math.abs(slot.target) - 1e-9) {
        slot.phase = "move";
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
    // Once a forklift has attached it to its fork (re-parented off the root) it carries the pallet: leave its pose alone.
    if (tf.item && tf.phase !== "receiving" && tf.item.group.parent === this.root) {
      const p = transferPoint(tf.object, tf.down);
      tf.item.group.position.copy(p);
      tf.item.group.rotation.set(0, tf.rail.object.yaw, 0);
    }
  }
  /**
   * Animated parts (recording): Transfer_Forklift_fork local y (authored rest y 1.27529 - down * downY) and the two
   * procedural stoppers (children of the carriage group, which moves by the same dy as the fork): local y, entry one drops while receiving.
   */
  getAnimatedParts(): AnimatedPart[] {
    const s = TRANSFER_CONFIG.stopper, p = TRANSFER_CONFIG.point, gap = STREAM_CONFIG.palletWidth / 2 + s.width / 2 + 0.02, out: AnimatedPart[] = [];
    for (const tf of this.transfers) {
      const id = tf.object.id, entryIndex = tf.side < 0 ? 1 : 0;
      out.push(animatedPart(id, "transfer", TRANSFER_CONFIG.forkNode, "posY", TRANSFER_FORK_REST_Y - tf.down * TRANSFER_CONFIG.downY, TRANSFER_FORK_REST_Y));
      [-1, 1].forEach((dir, i) => out.push(animatedPart(id, "transfer", dir < 0 ? "stopper-x" : "stopper+x", "posY", p.y - s.height / 2 + (i === entryIndex ? tf.entry : 1) * s.height, p.y + s.height / 2,
        { procedural: true, parent: "carriage", restPos: [p.x + dir * gap, p.y + s.height / 2, p.z] })));
    }
    return out;
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