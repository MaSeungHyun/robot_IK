import { Group, Vector3 } from "three";
import { CYCLE_CONFIG } from "@/constants/cycle";

/** Floor route planner (null = no route); the vehicle falls back to a straight line. */
export type CyclePlanner = (from: Vector3, to: Vector3, loaded: boolean) => Vector3[] | null;

/** A body other vehicles keep clear of: floor circles (world xz) with radii. */
export type CycleBody = { id: string; circles: () => readonly { x: number; z: number; r: number }[] };

type Action =
  | { type: "path"; to: Vector3; loaded: boolean; ignore?: readonly string[] }
  | { type: "straight"; to: Vector3; backward: boolean; speed: number; ignore?: readonly string[] }
  | { type: "turn"; heading: number }
  | { type: "fork"; y: number }
  | { type: "call"; run: () => void }
  | { type: "until"; test: () => boolean };

const TAU = Math.PI * 2;
/** Ring (m) and samples tried around a blocked start or goal before falling back to a straight line. */
const APPROACH_RADII = [1, 1.6, 2.4];
const APPROACH_STEPS = 8;

/**
 * Pallet-cycle vehicle (shuttle AMR, forklift, AGV): a carrier group driven by a queue of
 * primitive actions (plan + follow a route, turn in place, straight creep forward / backward,
 * fork / lift height, callbacks, wait-until). The owner composes job sequences from them.
 * Traffic: before each move the vehicle checks the other bodies; it holds while the move would
 * bring it closer than the safety gap, replans after holdTimeout and proceeds after giveUp (counted
 * in `overrides`, so a deadlock never stalls the run). Fixed-step only: identical at any speed.
 */
export type CycleVehicleOptions = {
  speed: number;
  /** Local body circles (z along forward, radius), loaded variant optional. */
  circles: readonly { z: number; r: number }[];
  loadedCircles?: readonly { z: number; r: number }[];
  plan: CyclePlanner;
  bodies: () => readonly CycleBody[];
  fork?: { group: Group; rest: number; speed: number };
};
export class CycleVehicle {
  readonly carrier = new Group();
  /** Forklift fork / AGV lift plate (child of the carrier), or null. */
  readonly fork: Group | null;
  private readonly forkRest: number;
  path: Vector3[] = [];
  version = 0;
  private cursor = 0;
  private queue: Action[] = [];
  private started = false;
  private hold = 0;
  /** Times a held vehicle proceeded anyway / routes that fell back to a straight line. */
  overrides = 0;
  fallbacks = 0;
  /** Seconds spent held by traffic. */
  heldSeconds = 0;
  readonly id: string;
  readonly name: string;
  private readonly options: CycleVehicleOptions;
  constructor(id: string, name: string, pose: { x: number; z: number; yaw: number }, options: CycleVehicleOptions) {
    this.id = id;
    this.name = name;
    this.options = options;
    this.body = { id, circles: () => this.circlesAt(this.carrier.position.x, this.carrier.position.z, this.carrier.rotation.y) };
    this.carrier.position.set(pose.x, 0, pose.z);
    this.carrier.rotation.y = pose.yaw;
    this.carrier.userData.sceneId = id;
    this.fork = options.fork?.group ?? null;
    this.forkRest = options.fork?.rest ?? 0;
    if (this.fork) {
      this.fork.position.y = this.forkRest;
      this.carrier.add(this.fork);
    }
  }
  loaded = false;
  get pathCursor() {
    return this.cursor;
  }
  get idle() {
    return this.queue.length === 0;
  }
  get position() {
    return this.carrier.position;
  }
  get heading() {
    return this.carrier.rotation.y;
  }
  /** Fork / lift height above its rest position. */
  get lift() {
    return this.fork ? this.fork.position.y - this.forkRest : 0;
  }
  readonly body: CycleBody;
  private scratch: { x: number; z: number; r: number }[] = [];
  private circlesAt(x: number, z: number, heading: number) {
    const local = this.loaded && this.options.loadedCircles ? this.options.loadedCircles : this.options.circles;
    const sin = Math.sin(heading), cos = Math.cos(heading);
    this.scratch.length = local.length;
    local.forEach((c, i) => {
      const item = this.scratch[i] ?? (this.scratch[i] = { x: 0, z: 0, r: 0 });
      item.x = x + sin * c.z;
      item.z = z + cos * c.z;
      item.r = c.r;
    });
    return this.scratch;
  }
  /** Smallest surface gap between this vehicle at (x, z, heading) and the other bodies. */
  private gapAt(x: number, z: number, heading: number, ignore?: readonly string[]) {
    const own = this.circlesAt(x, z, heading).map((c) => ({ ...c }));
    let gap = Infinity;
    for (const other of this.options.bodies()) {
      if (other.id === this.id || ignore?.includes(other.id)) continue;
      for (const a of other.circles())
        for (const b of own) gap = Math.min(gap, Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r);
    }
    return gap;
  }
  /** Seconds left of a deadlock pass (after giveUp) during which traffic is ignored. */
  private pass = 0;
  private clearToMove(x: number, z: number, heading: number, dt: number, ignore?: readonly string[]) {
    if (this.pass > 0) {
      this.pass -= dt;
      return true;
    }
    const next = this.gapAt(x, z, heading, ignore);
    const now = next >= CYCLE_CONFIG.safetyGap ? Infinity : this.gapAt(this.carrier.position.x, this.carrier.position.z, this.carrier.rotation.y, ignore);
    // Moving away from (or along) a body that is already close is always allowed.
    if (next >= CYCLE_CONFIG.safetyGap || next >= now - 1e-4) {
      this.hold = 0;
      return true;
    }
    this.hold += dt;
    this.heldSeconds += dt;
    if (this.hold >= CYCLE_CONFIG.giveUp) {
      // Mutual hold (two vehicles facing each other): pass through for a short window (counted as override).
      this.overrides++;
      this.hold = 0;
      this.pass = CYCLE_CONFIG.passTime;
      return true;
    }
    return false;
  }

  /** Queues actions (fluent). */
  goTo(to: Vector3, loaded = this.loaded, ignore?: readonly string[]) {
    this.queue.push({ type: "path", to: to.clone().setY(0), loaded, ignore });
    return this;
  }
  straight(to: Vector3, options: { backward?: boolean; speed?: number; ignore?: readonly string[] } = {}) {
    this.queue.push({ type: "straight", to: to.clone().setY(0), backward: options.backward ?? false, speed: options.speed ?? CYCLE_CONFIG.creepSpeed, ignore: options.ignore });
    return this;
  }
  turn(heading: number) {
    this.queue.push({ type: "turn", heading });
    return this;
  }
  forkTo(y: number) {
    this.queue.push({ type: "fork", y });
    return this;
  }
  then(run: () => void) {
    this.queue.push({ type: "call", run });
    return this;
  }
  until(test: () => boolean) {
    this.queue.push({ type: "until", test });
    return this;
  }

  advance(dt: number) {
    let budget = dt;
    // Several instant actions (calls, finished moves) may run in one step; bounded to avoid loops.
    for (let guard = 0; guard < 16 && this.queue.length && budget > 1e-9; guard++) {
      const action = this.queue[0];
      const done = this.run(action, budget);
      if (done === false) return;
      budget = done;
      this.queue.shift();
      this.started = false;
      this.hold = 0;
    }
  }
  /** Runs `action` for up to `dt`; returns the unused time once finished, false while running. */
  private run(action: Action, dt: number): number | false {
    switch (action.type) {
      case "call":
        action.run();
        return dt;
      case "until":
        return action.test() ? dt : false;
      case "turn": {
        const position = this.carrier.rotation;
        const target = action.heading + TAU * Math.round((position.y - action.heading) / TAU);
        const diff = target - position.y, step = CYCLE_CONFIG.turnRate * dt;
        if (Math.abs(diff) <= step) {
          position.y = target;
          return dt - Math.abs(diff) / CYCLE_CONFIG.turnRate;
        }
        const next = position.y + Math.sign(diff) * step;
        if (!this.clearToMove(this.carrier.position.x, this.carrier.position.z, next, dt)) return false;
        position.y = next;
        return false;
      }
      case "fork": {
        if (!this.fork) return dt;
        const speed = this.options.fork!.speed, goal = this.forkRest + action.y;
        const diff = goal - this.fork.position.y;
        if (Math.abs(diff) <= speed * dt) {
          this.fork.position.y = goal;
          return dt - Math.abs(diff) / speed;
        }
        this.fork.position.y += Math.sign(diff) * speed * dt;
        return false;
      }
      case "straight":
        return this.drive([action.to], action.speed, dt, action.backward, action.ignore);
      case "path": {
        if (!this.started) {
          this.started = true;
          this.plan(action);
        }
        if (this.hold >= CYCLE_CONFIG.holdTimeout && this.hold - dt < CYCLE_CONFIG.holdTimeout) this.plan(action);
        const left = this.drive(this.path, this.options.speed, dt, false, action.ignore, true);
        if (left !== false) {
          this.path = [];
          this.version++;
        }
        return left;
      }
    }
  }
  private plan(action: Extract<Action, { type: "path" }>) {
    const from = this.carrier.position.clone();
    let route = this.options.plan(from, action.to, action.loaded) ?? this.planViaApproach(from, action.to, action.loaded);
    if (!route || route.length < 2) {
      this.fallbacks += route ? 0 : 1;
      route = [from, action.to.clone()];
    }
    this.path = route.map((p) => p.clone().setY(0));
    // The first waypoint is the start itself.
    this.cursor = 1;
    this.version++;
  }
  /**
   * Start or goal inside an envelope (e.g. a shuttle home at a belt end): plans to/from the nearest free point on a
   * ring around it and drives the last short leg straight, instead of a straight line the whole way.
   */
  private planViaApproach(from: Vector3, to: Vector3, loaded: boolean): Vector3[] | null {
    const ring = (center: Vector3) =>
      APPROACH_RADII.flatMap((r) => Array.from({ length: APPROACH_STEPS }, (_, i) => {
        const a = (i / APPROACH_STEPS) * TAU;
        return new Vector3(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r);
      }));
    let best: Vector3[] | null = null, bestLength = Infinity;
    const consider = (route: Vector3[] | null, head: Vector3[], tail: Vector3[]) => {
      if (!route || route.length < 2) return;
      const full = [...head, ...route, ...tail];
      let length = 0;
      for (let i = 1; i < full.length; i++) length += full[i].distanceTo(full[i - 1]);
      if (length < bestLength) {
        best = full;
        bestLength = length;
      }
    };
    for (const goal of ring(to)) consider(this.options.plan(from, goal, loaded), [], [to.clone()]);
    if (best) return best;
    for (const start of ring(from)) consider(this.options.plan(start, to, loaded), [from.clone()], []);
    return best;
  }
  /** Follows `points` (from the cursor when `route`); turns towards each waypoint first. */
  private drive(points: Vector3[], speed: number, dt: number, backward: boolean, ignore?: readonly string[], route = false): number | false {
    let remaining = dt;
    let index = route ? this.cursor : 0;
    const position = this.carrier.position;
    while (remaining > 1e-9 && index < points.length) {
      const point = points[index], dx = point.x - position.x, dz = point.z - position.z, length = Math.hypot(dx, dz);
      if (length < 1e-4) {
        index++;
        continue;
      }
      if (!backward) {
        // Turn in place towards the waypoint before driving (route corners).
        const heading = Math.atan2(dx, dz);
        const target = heading + TAU * Math.round((this.carrier.rotation.y - heading) / TAU);
        const diff = target - this.carrier.rotation.y;
        if (Math.abs(diff) > 0.02 && length > 0.05) {
          const step = CYCLE_CONFIG.turnRate * remaining;
          if (Math.abs(diff) > step) {
            const next = this.carrier.rotation.y + Math.sign(diff) * step;
            if (!this.clearToMove(position.x, position.z, next, remaining, ignore)) break;
            this.carrier.rotation.y = next;
            remaining = 0;
            break;
          }
          this.carrier.rotation.y = target;
          remaining -= Math.abs(diff) / CYCLE_CONFIG.turnRate;
        }
      }
      const move = Math.min(length, speed * remaining);
      const nx = position.x + (dx / length) * move, nz = position.z + (dz / length) * move;
      if (!this.clearToMove(nx, nz, this.carrier.rotation.y, remaining, ignore)) {
        remaining = 0;
        break;
      }
      position.x = nx;
      position.z = nz;
      remaining -= move / speed;
      if (move >= length - 1e-9) index++;
    }
    if (route) this.cursor = index;
    return index >= points.length ? Math.max(0, remaining) : false;
  }
}
