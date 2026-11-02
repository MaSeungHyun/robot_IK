import { Group, Vector3 } from "three";
import { CYCLE_CONFIG } from "@/constants/cycle";
import { AMR_TRAFFIC } from "@/constants/simulatorLayout";

/** Floor route planner (null = no route); the vehicle falls back to a straight line. */
export type CyclePlanner = (from: Vector3, to: Vector3, loaded: boolean, avoid?: readonly { x: number; z: number; r: number }[]) => Vector3[] | null;

/** A body other vehicles keep clear of: floor circles (world xz) with radii. */
/** `clearance`: centre-to-centre keep-out radius (AMR footprint); two bodies with clearance stay ??the sum apart. */
export type CycleBody = { id: string; circles: () => readonly { x: number; z: number; r: number }[]; clearance?: number; center?: () => { x: number; z: number }; held?: () => number; loaded?: () => boolean };

type Action =
  | { type: "path"; to: Vector3; loaded: boolean; ignore?: readonly string[]; via?: readonly Vector3[] }
  | { type: "straight"; to: Vector3; backward: boolean; speed: number; ignore?: readonly string[] }
  | { type: "turn"; heading: number; symmetric: boolean }
  | { type: "fork"; y: number }
  | { type: "call"; run: () => void }
  | { type: "until"; test: () => boolean };

const TAU = Math.PI * 2;
/** Ring (m) and samples tried around a blocked start or goal before falling back to a straight line. */
const APPROACH_RADII = [1, 1.6, 2.4];
const APPROACH_STEPS = 8;
/** Traffic back-off: after `after` s blocked the lower-priority vehicle reverses (longest free distance first), then replans
 * around the blocker; `cooldown` s between back-offs, at most `tries` per move (then it just waits). */
const BACKOFF = { after: 2.5, distances: [1.5, 1.2, 0.8, 0.5], speed: 0.5, cooldown: 6, tries: 3, mutual: 0.5, abort: 2, retryAfter: 6 };
/** Bodies never come closer than this (m), even in a deadlock pass: no rubbing. */
const CONTACT = 0.03;
/**
 * Shared per-step budget of grid searches for traffic detours (all cycle vehicles together). PalletCycle resets it every
 * simulation step; without a reset (other users) it is unlimited, i.e. the search completes at once.
 */
const planning = { budget: Infinity };
export const PLANNING_SEARCHES_PER_STEP = 4;
export function beginPlanningStep(searches = PLANNING_SEARCHES_PER_STEP) {
  planning.budget = searches;
}
/** Steps a search while budget remains; returns the final result once it is done. */
function advanceSearch<T>(search: Generator<void, T>): { value: T } | null {
  while (planning.budget > 0) {
    planning.budget--;
    const next = search.next();
    if (next.done) return { value: next.value };
  }
  return null;
}
/** Runs a search to the end (static routes: memoised and needed at once). */
function run<T>(search: Generator<void, T>): T {
  for (;;) {
    const next = search.next();
    if (next.done) return next.value;
  }
}

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
  /** Footprint keep-out radius (centre distance to another clearance body never drops below the sum). */
  clearance?: number;
  /** Planner circle about this vehicle's origin (forklift fork swing). Omitted: the AMR body circle. */
  span?: number;
  loadedCircles?: readonly { z: number; r: number }[];
  plan: CyclePlanner;
  bodies: () => readonly CycleBody[];
  fork?: { group: Group; rest: number; speed: number };
  /** When held, turn out to the side and search another route. Without it, the vehicle reverses and replans. */
  divert?: boolean;
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
  /** Traffic detour search in progress (spread over steps by the planning budget). */
  private detour: Generator<void, Vector3[] | null> | null = null;
  private hold = 0;
  /** Times a held vehicle proceeded anyway / routes that fell back to a straight line. */
  overrides = 0;
  fallbacks = 0;
  /** Seconds spent held by traffic. */
  heldSeconds = 0;
  /** Back-offs (reverse + replan) and traffic replans started. */
  backoffs = 0;
  replans = 0;
  private backCooldown = 0;
  private backTries = 0;
  private replanAfterBack = false;
  /** Where the last side-route search started, so a later block further along the trip can search again. */
  private divertAt = new Vector3(Infinity, 0, Infinity);
  /** Backing off for another vehicle (?묐낫) until the replan after the reverse move. */
  get yielding() {
    return this.replanAfterBack;
  }
  readonly id: string;
  readonly name: string;
  private readonly options: CycleVehicleOptions;
  constructor(id: string, name: string, pose: { x: number; z: number; yaw: number }, options: CycleVehicleOptions) {
    this.id = id;
    this.name = name;
    this.options = options;
    this.body = { id, circles: () => this.circlesAt(this.carrier.position.x, this.carrier.position.z, this.carrier.rotation.y), clearance: options.clearance, center: () => this.carrier.position, held: () => this.hold, loaded: () => this.loaded };
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
  /** Seconds this vehicle has been held by another body in its current move. */
  get held() {
    return this.hold;
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
      const mine = this.options.clearance;
      if (mine && other.clearance && other.center) {
        const c = other.center();
        gap = Math.min(gap, Math.hypot(c.x - x, c.z - z) - mine - other.clearance);
      }
    }
    return gap;
  }
  /** Seconds left of a deadlock pass (after giveUp): the safety gap is waived, but bodies never overlap. */
  private pass = 0;
  private clearToMove(x: number, z: number, heading: number, dt: number, ignore?: readonly string[]) {
    const next = this.gapAt(x, z, heading, ignore);
    if (this.pass > 0) {
      this.pass -= dt;
      // A deadlock pass squeezes inside the safety gap but never lets two bodies overlap.
      if (next >= CONTACT) return true;
    }
    const now = next >= CYCLE_CONFIG.safetyGap ? Infinity : this.gapAt(this.carrier.position.x, this.carrier.position.z, this.carrier.rotation.y, ignore);
    // Moving away from (or along) a body that is already close is always allowed.
    if (next >= CYCLE_CONFIG.safetyGap || (next >= now - 1e-4 && (next >= CONTACT || next > now + 1e-4))) {
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

  /** Route speed (m/s) now; braking for whatever is ahead. Ramped, with a resume margin so it does not stutter. */
  private velocity = 0;
  private stopped = false;
  private lookAhead(max: number, dt: number, ignore?: readonly string[]) {
    const { brakeDecel, accel, lookMargin, resumeMargin, safetyGap } = CYCLE_CONFIG;
    // Deadlock pass: the step-by-step guard alone (keeps it from overlapping).
    if (this.pass > 0) return (this.velocity = max);
    const position = this.carrier.position;
    const now = this.gapAt(position.x, position.z, this.carrier.rotation.y, ignore);
    // Free distance along the route before a pose that comes inside the safety gap (closing in only).
    const reach = (max * max) / (2 * brakeDecel) + lookMargin + resumeMargin;
    let free = Infinity, travelled = 0, x = position.x, z = position.z;
    for (let i = this.cursor; i < this.path.length && travelled < reach && free === Infinity; i++) {
      const p = this.path[i], length = Math.hypot(p.x - x, p.z - z);
      if (length < 1e-4) continue;
      const heading = Math.atan2(p.x - x, p.z - z);
      for (let s = Math.min(0.2, length); travelled + s <= reach + 0.2; s = Math.min(length, s + 0.2)) {
        const g = this.gapAt(x + ((p.x - x) / length) * s, z + ((p.z - z) / length) * s, heading, ignore);
        if (g < safetyGap && g < now - 1e-4) {
          free = travelled + s;
          break;
        }
        if (s >= length) break;
      }
      travelled += length;
      x = p.x;
      z = p.z;
    }
    // Hysteresis: once stopped, restart only with resumeMargin of room beyond the stop margin.
    const room = free - lookMargin - (this.stopped ? resumeMargin : 0);
    const target = room <= 0 ? 0 : Math.min(max, Math.sqrt(2 * brakeDecel * room));
    this.velocity = target > this.velocity ? Math.min(target, this.velocity + accel * dt) : target;
    if (this.velocity < 0.05 && target < 0.05) {
      this.velocity = 0;
      this.stopped = true;
      // Held short of the other body: counts toward detour / giveUp like a blocked step.
      this.hold += dt;
      this.heldSeconds += dt;
      if (this.hold >= CYCLE_CONFIG.giveUp) {
        this.overrides++;
        this.hold = 0;
        this.pass = CYCLE_CONFIG.passTime;
        return (this.velocity = max);
      }
      return 0;
    }
    this.stopped = false;
    return Math.max(this.velocity, 0.05);
  }

  /** Queues actions (fluent). */
  /** `via`: fixed waypoints (e.g. an AGV 경로) driven in order instead of a planned route; traffic still holds it, no detours. */
  goTo(to: Vector3, loaded = this.loaded, ignore?: readonly string[], via?: readonly Vector3[]) {
    this.queue.push({ type: "path", to: to.clone().setY(0), loaded, ignore, via: via?.length ? via.map((p) => p.clone().setY(0)) : undefined });
    return this;
  }
  straight(to: Vector3, options: { backward?: boolean; speed?: number; ignore?: readonly string[] } = {}) {
    this.queue.push({ type: "straight", to: to.clone().setY(0), backward: options.backward ?? false, speed: options.speed ?? CYCLE_CONFIG.creepSpeed, ignore: options.ignore });
    return this;
  }
  /** Turn in place, shortest way round. `symmetric`: either end may face `heading` (짹?, whichever is nearer). */
  turn(heading: number, symmetric = false) {
    this.queue.push({ type: "turn", heading, symmetric });
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

  /**
   * Drops the queued actions (a return home being cut short by a new job) and hands them back so `restore` can resume
   * them when no job was found. The next queued path re-plans from the current pose.
   */
  interrupt() {
    const saved = this.queue;
    // Snapshot of the running move: restoring it (no job found) must not reset the route, speed or hold every step,
    // or a returning vehicle polled each frame never moves and never counts as held (no back-off, no replan).
    this.snapshot = { queue: saved, started: this.started, detour: this.detour, hold: this.hold, path: this.path, version: this.version };
    this.queue = [];
    this.started = false;
    this.detour = null;
    this.hold = 0;
    this.path = [];
    this.version++;
    return saved;
  }
  private snapshot: { queue: Action[]; started: boolean; detour: Generator<void, Vector3[] | null> | null; hold: number; path: Vector3[]; version: number } | null = null;
  restore(saved: Action[]) {
    if (this.queue.length) return;
    const snap = this.snapshot;
    this.snapshot = null;
    this.queue = saved;
    if (snap && snap.queue === saved) {
      this.started = snap.started;
      this.detour = snap.detour;
      this.hold = snap.hold;
      this.path = snap.path;
      this.version = snap.version;
    }
  }

  advance(dt: number) {
    this.backCooldown -= dt;
    let budget = dt;
    // Several instant actions (calls, finished moves) may run in one step; bounded to avoid loops.
    for (let guard = 0; guard < 16 && this.queue.length && budget > 1e-9; guard++) {
      const action = this.queue[0];
      const done = this.run(action, budget);
      if (done === false) return;
      budget = done;
      const finished = this.queue.shift();
      if (finished?.type === "path") this.backTries = 0;
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
        const period = action.symmetric ? Math.PI : TAU;
        const target = action.heading + period * Math.round((position.y - action.heading) / period);
        const raw = target - position.y, diff = Math.atan2(Math.sin(raw), Math.cos(raw)), step = CYCLE_CONFIG.turnRate * dt;
        if (Math.abs(diff) <= step) {
          position.y += diff;
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
        // A traffic back-off that is itself blocked ends where it is (the replan follows).
        if (action.backward && this.hold >= BACKOFF.abort) return dt;
        return this.drive([action.to], action.speed, dt, action.backward, action.ignore);
      case "path": {
        if (!this.started) {
          this.started = true;
          this.velocity = 0;
          this.detour = null;
          // A diverting vehicle waits for the side search instead of driving the straight route again.
          if (action.via) {
            this.replanAfterBack = false;
            this.plan(action);
          } else if (this.replanAfterBack && this.options.divert) {
            this.replanAfterBack = false;
            this.replans++;
            this.path = [];
            this.detour = this.divertSearch(action);
          } else {
            this.plan(action);
            if (this.replanAfterBack) {
              this.replanAfterBack = false;
              this.replans++;
              this.detour = this.detourSearch(action);
            }
          }
        }
        if (action.via) {
          // Fixed route: brake for traffic on it, never search a detour.
          const speed = this.lookAhead(this.options.speed, dt, action.ignore);
          const left = speed > 0 ? this.drive(this.path, speed, dt, false, action.ignore, true) : false;
          if (left !== false) {
            this.path = [];
            this.version++;
          }
          return left;
        }
        if (this.options.divert) {
          const here = this.carrier.position;
          if (Math.hypot(here.x - this.divertAt.x, here.z - this.divertAt.z) > 3) this.backTries = 0;
          const crossed = this.hold >= CYCLE_CONFIG.holdTimeout && this.hold - dt < CYCLE_CONFIG.holdTimeout;
          if (crossed && !this.detour && (this.backTries < BACKOFF.tries || this.hold >= BACKOFF.retryAfter)) {
            this.replans++;
            this.backTries++;
            this.divertAt.copy(here);
            this.detour = this.divertSearch(action);
          }
        } else if (this.hold >= BACKOFF.after && this.backCooldown <= 0 && (this.backTries < BACKOFF.tries || this.hold >= BACKOFF.retryAfter) && this.backOff(action)) return false;
        // Blocked: replan around the other vehicles (as obstacles) instead of pushing through them. The search runs
        // over the next steps within the shared planning budget; meanwhile the vehicle keeps its (held) route.
        if (!this.options.divert && this.hold >= CYCLE_CONFIG.holdTimeout && this.hold - dt < CYCLE_CONFIG.holdTimeout) {
          this.replans++;
          this.detour = this.detourSearch(action);
        }
        if (this.detour) {
          const done = advanceSearch(this.detour);
          if (done) {
            this.detour = null;
            if (done.value && done.value.length >= 2) {
              this.setPath(done.value);
              this.hold = 0;
              this.velocity = 0;
            } else if (this.options.divert) {
              // No side route: reverse just enough to make room for the next turn. Straight is only the last resort.
              if (this.backOff(action)) return false;
              if (this.path.length < 2) this.plan(action);
            } else this.plan(action);
          }
          if (this.options.divert && this.path.length < 2) return false;
        }
        const speed = this.lookAhead(this.options.speed, dt, action.ignore);
        const left = speed > 0 ? this.drive(this.path, speed, dt, false, action.ignore, true) : false;
        if (left !== false) {
          this.path = [];
          this.detour = null;
          this.version++;
        }
        return left;
      }
    }
  }
  /** Nearest other body within reach of this vehicle (the one holding it). */
  private blocker(ignore?: readonly string[]) {
    const own = this.circlesAt(this.carrier.position.x, this.carrier.position.z, this.carrier.rotation.y).map((c) => ({ ...c }));
    let best: CycleBody | null = null, gap = CYCLE_CONFIG.safetyGap + CYCLE_CONFIG.lookMargin + CYCLE_CONFIG.resumeMargin + 0.6;
    for (const other of this.options.bodies()) {
      if (other.id === this.id || ignore?.includes(other.id)) continue;
      let g = Infinity;
      for (const a of other.circles()) for (const b of own) g = Math.min(g, Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r);
      if (g < gap) { gap = g; best = other; }
    }
    return best;
  }
  /**
   * Held too long: unless the blocker is itself held and has lower priority (empty yields to loaded, then the larger id
   * yields), reverse a short free distance along the heading, then replan around the blocker's footprint. The other proceeds.
   */
  private backOff(action: Extract<Action, { type: "path" }>) {
    const other = this.blocker(action.ignore);
    if (!other) return false;
    const mutual = (other.held?.() ?? 0) >= BACKOFF.mutual;
    if (mutual) {
      const mine = Number(this.loaded), theirs = Number(other.loaded?.() ?? false);
      const yields = mine !== theirs ? mine < theirs : this.id.localeCompare(other.id) > 0;
      // The designated yielder may have no room behind it: after a long mutual hold the other one tries as well.
      if (!yields && this.hold < BACKOFF.after * 4) return false;
    }
    const p = this.carrier.position, h = this.carrier.rotation.y, sin = Math.sin(h), cos = Math.cos(h);
    const now = this.gapAt(p.x, p.z, h, action.ignore);
    for (const d of BACKOFF.distances) {
      let ok = true;
      for (let s = 0.1; s <= d + 1e-9 && ok; s += 0.1) ok = this.gapAt(p.x - sin * s, p.z - cos * s, h, action.ignore) >= Math.min(CYCLE_CONFIG.safetyGap, now);
      if (!ok) continue;
      const to = new Vector3(p.x - sin * d, 0, p.z - cos * d);
      // Floor check (walls / equipment): a near-straight route must exist to the back-off point.
      const route = this.options.plan(p.clone(), to, this.loaded);
      if (!route) continue;
      let length = 0;
      for (let i = 1; i < route.length; i++) length += route[i].distanceTo(route[i - 1]);
      if (length > d * 1.4 + 0.3) continue;
      this.queue.unshift({ type: "straight", to, backward: true, speed: Math.min(this.options.speed, CYCLE_CONFIG.creepSpeed * 2) * BACKOFF.speed * 2, ignore: action.ignore });
      this.started = false;
      this.detour = null;
      this.hold = 0;
      this.backoffs++;
      this.backTries++;
      this.backCooldown = BACKOFF.cooldown;
      this.replanAfterBack = true;
      return true;
    }
    return false;
  }
  private plan(action: Extract<Action, { type: "path" }>) {
    const from = this.carrier.position.clone();
    if (action.via) {
      this.setPath([from, ...action.via, action.to.clone()]);
      return;
    }
    let route = this.options.plan(from, action.to, action.loaded) ?? run(this.approach(from, action.to, action.loaded));
    if (!route || route.length < 2) {
      this.fallbacks += route ? 0 : 1;
      route = [from, action.to.clone()];
    }
    this.setPath(route);
  }
  private setPath(route: readonly Vector3[]) {
    this.path = route.map((p) => p.clone().setY(0));
    // The first waypoint is the start itself.
    this.cursor = 1;
    this.version++;
  }
  /** Length of a polyline. */
  private lengthOf(points: readonly Vector3[]) {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
    return length;
  }
  /** The straight step to `to` does not close on another body. */
  private segmentClear(from: Vector3, to: Vector3, ignore?: readonly string[]) {
    const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
    if (length < 0.3) return false;
    const heading = Math.atan2(dx, dz);
    const now = this.gapAt(from.x, from.z, this.carrier.rotation.y, ignore);
    for (let s = 0.4; s <= length + 1e-9; s += 0.4) {
      const u = Math.min(s, length) / length;
      const gap = this.gapAt(from.x + dx * u, from.z + dz * u, heading, ignore);
      if (gap < CYCLE_CONFIG.safetyGap && gap < now - 0.02) return false;
    }
    return true;
  }
  /**
   * Held AGV: turn out to the side of the blocker and search a route from there. The other vehicles stay at full
   * size, so the result bends around them instead of reversing and taking the same straight line.
   * Yields around each grid search (see detourSearch). Returns null when every side is closed.
   */
  private *divertSearch(action: Extract<Action, { type: "path" }>): Generator<void, Vector3[] | null> {
    const from = this.carrier.position.clone();
    const yaw = this.carrier.rotation.y;
    const other = this.blocker(action.ignore);
    const center = other?.center?.();
    const blockedH = center ? Math.atan2(center.x - from.x, center.z - from.z) : yaw;
    const circles = this.trafficCircles(from, action.to, action.ignore, false);
    const offsets = [Math.PI / 2, -Math.PI / 2, Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3, (-2 * Math.PI) / 3, 2.6, -2.6];
    for (const off of offsets) {
      const h = blockedH + off, sin = Math.sin(h), cos = Math.cos(h);
      for (const d of [4.2, 6.4]) {
        const turn = new Vector3(from.x + sin * d, 0, from.z + cos * d);
        if (!this.segmentClear(from, turn, action.ignore)) {
          yield;
          continue;
        }
        yield;
        const leg = this.options.plan(from, turn, action.loaded);
        if (!leg || leg.length < 2 || this.lengthOf(leg) > d * 1.8 + 0.8) continue;
        const head = Math.atan2(leg[1].x - from.x, leg[1].z - from.z);
        if (Math.abs(Math.atan2(Math.sin(head - blockedH), Math.cos(head - blockedH))) < 0.45) continue;
        yield;
        const route = this.options.plan(turn, action.to, action.loaded, circles);
        if (!route || route.length < 2) continue;
        return [...leg, ...route.slice(1)];
      }
    }
    return null;
  }
  /** Other vehicles as planner circles. `shrink`: pull back a circle that already contains this vehicle (start must be free). */
  private trafficCircles(from: Vector3, to: Vector3, ignore: readonly string[] | undefined, shrink: boolean) {
    return this.options.bodies()
      .filter((other) => other.id !== this.id && !ignore?.includes(other.id))
      .flatMap((other) => {
        // The planner inflates every circle by the vehicle circle. A forklift capsule is narrower, so hand back
        // the difference and the surface gap stays the safety gap. A clearance body is inflated by both radii.
        const planner = this.options.span ?? AMR_TRAFFIC.emptyRadius;
        const slack = this.options.clearance ? 0 : Math.max(0, planner - Math.max(...this.options.circles.map((o) => o.r)));
        const list = other.circles().map((c) => ({ x: c.x, z: c.z, r: Math.max(0, c.r + CYCLE_CONFIG.safetyGap - slack) }));
        if (this.options.clearance && other.clearance && other.center) {
          const c = other.center();
          list.push({ x: c.x, z: c.z, r: other.clearance + this.options.clearance - Math.max(...this.options.circles.map((o) => o.r)) + CYCLE_CONFIG.safetyGap });
        }
        return list;
      })
      .map((c) => {
        if (!shrink) return c;
        const own = this.circlesAt(from.x, from.z, this.carrier.rotation.y);
        const room = Math.min(...own.map((o) => Math.hypot(o.x - c.x, o.z - c.z) - o.r - 1e-3));
        return { ...c, r: Math.max(0, Math.min(c.r, room)) };
      })
      .filter((c) => Math.hypot(c.x - to.x, c.z - to.z) > c.r + 0.5 && Math.hypot(c.x - from.x, c.z - from.z) < 20);
  }
  /**
   * Traffic detour around the other vehicles (as obstacles). A generator that yields after every grid search, so the
   * work is spread over steps by the shared planning budget instead of stalling one frame (up to ~0.6 s before).
   * Returns the detour, or null when there is none (the caller then keeps the static route).
   */
  private *detourSearch(action: Extract<Action, { type: "path" }>): Generator<void, Vector3[] | null> {
    const from = this.carrier.position.clone();
    const circles = this.trafficCircles(from, action.to, action.ignore, true);
    const direct = this.options.plan(from, action.to, action.loaded, circles);
    if (direct) return direct;
    yield;
    return yield* this.approach(from, action.to, action.loaded, circles);
  }
  /**
   * Start or goal inside an envelope (e.g. a shuttle home at a belt end): plans to/from the nearest free point on a
   * ring around it and drives the last short leg straight, instead of a straight line the whole way.
   * Yields after every grid search (see detourSearch); `run` drives it to the end synchronously.
   */
  private *approach(from: Vector3, to: Vector3, loaded: boolean, avoid?: readonly { x: number; z: number; r: number }[]): Generator<void, Vector3[] | null> {
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
    // Branch and bound, same result as trying all: visit candidates by their straight-line length (a lower bound of
    // any route through them) and stop once that bound can no longer beat the best route found.
    const order = (points: Vector3[]) => points.map((p) => ({ p, b: from.distanceTo(p) + p.distanceTo(to) })).sort((x, y) => x.b - y.b);
    for (const { p: goal, b } of order(ring(to))) {
      if (b >= bestLength - 1e-9) break;
      consider(this.options.plan(from, goal, loaded, avoid), [], [to.clone()]);
      yield;
    }
    if (best) return best;
    for (const { p: start, b } of order(ring(from))) {
      if (b >= bestLength - 1e-9) break;
      consider(this.options.plan(start, to, loaded, avoid), [from.clone()], []);
      yield;
    }
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
