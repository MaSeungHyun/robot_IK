import { Group, Vector3 } from "three";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { FORKLIFT_CIRCLES, FORKLIFT_CONFIG, forkLiftFor, forkliftAxisDistance, forkliftStop } from "@/constants/forklift";

/**
 * Forklift (Forklift.glb), driven like a real forklift by `Forklift_point` (the fork-hole contact
 * point on the `Forklift.Fork` tines):
 * - store: picks a pallet a pallet AMR left on the floor hand-off point in front of a rack (stand off a
 *   fork length, fork to floor, drive in, lift, back out), drives to a slot standoff, raises the fork
 *   to the slot height (+ clearance), drives in by the slot depth, lowers the pallet onto the shelf,
 *   backs out and resets the fork.
 * - retrieve: takes a stored pallet out of a slot the same way and sets it down outside a door.
 * Racks are double sided: every slot can be served from the front (+X face) or the mirrored standoff
 * on the back with the heading flipped. Targets are tried in the owner's order (front, back, other
 * racks); a stuck forklift backs off along its heading and replans. Everything advances by the fixed
 * simulation step only, so runs are identical at any playback speed.
 */
export type ForkliftTarget = {
  rackId: string;
  slot: number;
  /** Slot point (y = shelf), heading facing into the rack and the standoff origin a fork length short of the insert pose. */
  slotPoint: Vector3;
  heading: number;
  approach: Vector3;
};

export type ForkliftJob = {
  /** "takeEmptyFromAmr": like store, but the pickup is an emptied pallet on an AMR deck (pickup.point.y = deck height) and the
   *  target the empty-pallet stack. */
  kind: "store" | "retrieve" | "takeEmptyFromAmr";
  /** Candidate slot targets in preference order (recomputed on every choice). */
  targets: () => ForkliftTarget[];
  /** Books `target` (releasing `previous`); false skips it. Optional (retrieve targets need no booking). */
  claim?: (target: ForkliftTarget, previous: ForkliftTarget | null) => boolean;
  /** store: floor pallet at the hand-off (fork-hole centre on the floor) and the heading to drive in. */
  pickup?: { point: Vector3; heading: number };
  /** store: returns the hand-off pallet group to carry. */
  take?: () => Group | null;
  /** store: called with the pallet on the shelf; the owner reparents it into the rack. */
  store?: (payload: Group, target: ForkliftTarget) => void;
  /** store: keep the pallet on the forks after `store` while this is true (e.g. a robot unloads it there), then
   *  `release` gets the (emptied) pallet and the forklift backs off. */
  hold?: () => boolean;
  /** Store target not ready yet (e.g. the receiving AMR is still driving in): the forklift waits at the approach. */
  ready?: () => boolean;
  release?: (payload: Group) => void;
  /** Scene id of the vehicle the pallet is handed to (traffic hold ignores it while placing). */
  peerId?: string;
  /** retrieve: door and floor points just inside / outside its opening. */
  doorId?: string;
  inside?: Vector3;
  outside?: Vector3;
  /** retrieve: returns the stored pallet group to carry, or null if gone. */
  pick?: () => Group | null;
  /** retrieve: called once the pallet has been set down outside; the owner removes it. */
  drop?: (payload: Group) => void;
};

/** Plans a floor route; null when no route exists. */
export type ForkliftPlanner = (from: Vector3, to: Vector3, loaded: boolean) => Vector3[] | null;

type Stage =
  | "toPick" | "alignPick" | "insertPick" | "liftPick" | "retreatPick" | "waitTarget" | "recover"
  | "toRack" | "align" | "raise" | "insert" | "lift" | "place" | "holdPlace" | "retreat" | "lower" | "reset"
  | "toDoor" | "waitDoor" | "toOutside" | "setDown" | "backOut" | "toInside" | "returning";

const STATUS: Record<Stage, string> = {
  toPick: "인계 지점 팔레트로 이동 중",
  alignPick: "팔레트 앞 정렬 (포크 길이만큼 이격)",
  insertPick: "팔레트 구멍에 포크 삽입 중",
  liftPick: "팔레트 들어올림",
  retreatPick: "팔레트 들고 후진",
  waitTarget: "적재할 랙 칸 대기 중",
  recover: "막힘 · 후진 후 경로 재계획",
  toRack: "랙으로 이동 중",
  align: "랙 앞 정렬 (포크 길이만큼 이격)",
  raise: "포크 상승 · 칸 높이 맞춤",
  insert: "포크 삽입 중",
  lift: "팔레트 들어올림",
  place: "칸에 팔레트 내려놓는 중",
  holdPlace: "팔레트를 든 채 로봇 하역 대기",
  retreat: "랙에서 후진",
  lower: "포크 운반 높이로 하강",
  reset: "포크 원위치",
  toDoor: "팔레트 반출 · 문으로 이동 중",
  waitDoor: "문 열림 대기",
  toOutside: "문 밖으로 반출 중",
  setDown: "문 밖에 팔레트 내려놓는 중",
  backOut: "포크 빼며 후진",
  toInside: "공장 안으로 복귀 중",
  returning: "대기 위치로 복귀 중",
};

/** Recovery: back off this far per try (m), at most this many tries, retry waits (s). */
const RECOVER_STEP = 0.5;
const RECOVER_TRIES = 6;
const RETRY_S = 2;

const targetKey = (t: ForkliftTarget) => `${t.rackId}:${t.slot}:${t.heading.toFixed(3)}`;

export class ForkliftController {
  readonly carrier = new Group();
  /** Fork group (the model's `Forklift.Fork` follows its y); carried pallets are its children. */
  readonly fork = new Group();
  readonly home: Vector3;
  private readonly homeYaw: number;
  job: ForkliftJob | null = null;
  stage: Stage | null = null;
  payload: Group | null = null;
  /** Slot target being driven to / served. */
  target: ForkliftTarget | null = null;
  path: Vector3[] = [];
  private cursor = 1;
  version = 0;
  private turnTarget: number | null = null;
  /** Fork lift above its rest height (m). */
  lift = 0;
  private insertAt = new Vector3();
  private backAt = new Vector3();
  private pickBack = new Vector3();
  private pickHeading = 0;
  /** Fork lift at the pickup (0 = floor pallet; deck pallet for takeEmptyFromAmr). */
  private pickLift = 0;
  private tried = new Set<string>();
  private tries = 0;
  private timer = 0;
  private pending: (() => void) | null = null;
  /** Set by the owner each step: whether the job's door is fully open. */
  doorOpen = false;
  completed = 0;
  stored = 0;
  recoveries = 0;
  private readonly plan: ForkliftPlanner;
  constructor(pose: { x: number; z: number; yaw: number }, plan: ForkliftPlanner) {
    this.plan = plan;
    this.home = new Vector3(pose.x, 0, pose.z);
    this.homeYaw = pose.yaw;
    this.carrier.position.copy(this.home);
    this.carrier.rotation.y = pose.yaw;
    this.fork.position.copy(FORKLIFT_CONFIG.fork);
    this.carrier.add(this.fork);
  }
  get idle() {
    return this.job === null;
  }
  /** Next waypoint index (route line rendering). */
  get pathCursor() {
    return this.cursor;
  }
  /** True while the door of the current job must be open (approaching it, passing, outside). */
  get needsDoor() {
    return this.stage === "toDoor" || this.stage === "waitDoor" || this.stage === "toOutside" || this.stage === "setDown" || this.stage === "backOut" || this.stage === "toInside";
  }
  get loaded() {
    return this.payload !== null;
  }
  /** Capsule half width (the footprint is a capsule from the counterweight to the tine tips, see FORKLIFT_CONFIG.footprint). */
  get radius() {
    return FORKLIFT_CONFIG.footprint.radius;
  }
  private readonly circles = FORKLIFT_CIRCLES.map(() => new Vector3());
  /** World circle centres (radius `radius`) covering the footprint at the current pose. */
  get bodies() {
    const { x, z } = this.carrier.position,
      heading = this.carrier.rotation.y,
      sin = Math.sin(heading),
      cos = Math.cos(heading);
    FORKLIFT_CIRCLES.forEach((along, i) => this.circles[i].set(x + sin * along, 0, z + cos * along));
    return this.circles;
  }
  /** Clearance from floor point (x, z) to the footprint of this forklift with its origin at `origin` (default: now). */
  clearance(x: number, z: number, origin: Vector3 = this.carrier.position) {
    return forkliftAxisDistance(x, z, origin.x, origin.z, this.carrier.rotation.y) - FORKLIFT_CONFIG.footprint.radius;
  }
  /** Driving a floor route (traffic applies); fork moves and slot insert/retreat are not. */
  get moving() {
    return this.stage === "toRack" || this.stage === "toDoor" || this.stage === "toOutside" || this.stage === "toInside" || this.stage === "returning";
  }
  /** End of the current route. */
  get goal() {
    return this.path[this.path.length - 1] ?? null;
  }
  /** Position after driving `delta` (s, speed-scaled) along the route, without moving. */
  predict(delta: number, out: Vector3) {
    out.copy(this.carrier.position);
    if (!this.moving) return out;
    let remaining = delta * SIMULATOR_CONFIG.amrSpeed;
    for (let i = this.cursor; i < this.path.length && remaining > 0; i++) {
      const point = this.path[i],
        length = out.distanceTo(point);
      if (length <= remaining) {
        out.copy(point);
        remaining -= length;
      } else {
        out.lerp(point, remaining / length);
        break;
      }
    }
    return out;
  }
  /** Replaces the rest of the current route (traffic detour); the stage is unchanged. */
  reroute(points: Vector3[]) {
    if (!this.moving || points.length < 2) return;
    this.path = points;
    this.cursor = 1;
    this.version++;
  }
  /** Set by the owner each step: true holds the AMR in place while driving (traffic). */
  held = false;
  get status() {
    return this.stage ? STATUS[this.stage] : "지게차 대기";
  }
  /** Starts a job; false (nothing changes) when neither the pickup nor any target can be reached. */
  start(job: ForkliftJob) {
    if (this.job) return false;
    this.tried.clear();
    this.tries = 0;
    if (job.kind !== "retrieve") {
      const pickup = job.pickup!;
      this.pickLift = job.kind === "takeEmptyFromAmr" ? Math.max(0, forkLiftFor(pickup.point.y)) : 0;
      // Pallets are four-way: try the delivery heading, the flipped one, then both sideways (narrow aisles).
      for (const heading of [pickup.heading, pickup.heading + Math.PI, pickup.heading + Math.PI / 2, pickup.heading - Math.PI / 2]) {
        const standoff = forkliftStop(pickup.point, heading, FORKLIFT_CONFIG.forkLength),
          route = this.plan(this.carrier.position, standoff, false);
        if (!route) continue;
        this.job = job;
        this.pickBack.copy(standoff);
        this.insertAt.copy(forkliftStop(pickup.point, heading));
        this.pickHeading = heading;
        this.follow(route, "toPick");
        return true;
      }
      return false;
    }
    this.job = job;
    if (this.chooseTarget()) return true;
    this.job = null;
    return false;
  }
  /** First reachable, bookable target not tried yet; drives toward it. */
  private chooseTarget() {
    const job = this.job!;
    for (const target of job.targets()) {
      if (this.tried.has(targetKey(target))) continue;
      const route = this.plan(this.carrier.position, target.approach, this.payload !== null);
      if (!route) continue;
      if (job.claim && !job.claim(target, this.target)) continue;
      this.target = target;
      this.insertAt.copy(forkliftStop(target.slotPoint, target.heading));
      this.follow(route, "toRack");
      return true;
    }
    return false;
  }
  /** Chooses a target, else backs off and retries, else waits and retries. */
  private chooseOrRecover() {
    if (this.chooseTarget()) return;
    if (this.tries < RECOVER_TRIES) return this.recover(() => this.chooseOrRecover());
    this.tried.clear();
    this.tries = 0;
    this.timer = 0;
    this.stage = "waitTarget";
    this.path = [];
    this.version++;
  }
  /** Backs straight off along the heading, then runs `next` (replan from the freed position). */
  private recover(next: () => void) {
    const heading = this.carrier.rotation.y;
    this.tries++;
    this.recoveries++;
    this.backAt.set(this.carrier.position.x - Math.sin(heading) * RECOVER_STEP, 0, this.carrier.position.z - Math.cos(heading) * RECOVER_STEP);
    this.pending = next;
    this.stage = "recover";
    this.path = [];
    this.version++;
  }
  /**
   * Owner: the forklift has been held by traffic too long (or overlaps a rack). Driving to a rack it
   * switches to the next target (other side / other rack); otherwise it backs off and replans.
   */
  blocked() {
    if (!this.job || !this.moving) return;
    if (this.stage === "toRack" && this.target) {
      this.tried.add(targetKey(this.target));
      if (this.chooseTarget()) return;
      this.tried.clear();
    }
    const goal = this.goal?.clone(),
      stage = this.stage!,
      loaded = this.payload !== null;
    if (!goal) return;
    this.recover(() => this.route(goal, loaded, stage));
  }
  private follow(points: Vector3[], stage: Stage) {
    this.path = points;
    this.cursor = 1;
    this.stage = stage;
    this.version++;
  }
  private route(to: Vector3, loaded: boolean, stage: Stage) {
    const from = this.carrier.position.clone(),
      points = this.plan(from, to, loaded);
    if (!points && this.tries < RECOVER_TRIES) return this.recover(() => this.route(to, loaded, stage));
    this.tries = 0;
    this.follow(points ?? [from, to.clone()], stage);
  }  /** Moves along `path`; true once its end is reached. */
  private drive(delta: number) {
    let distance = delta * SIMULATOR_CONFIG.amrSpeed;
    const position = this.carrier.position;
    while (distance > 0 && this.cursor < this.path.length) {
      const point = this.path[this.cursor],
        dx = point.x - position.x,
        dz = point.z - position.z,
        length = Math.hypot(dx, dz);
      if (length < 1e-8) {
        this.cursor++;
        continue;
      }
      this.carrier.rotation.y = Math.atan2(dx, dz);
      if (distance >= length) {
        position.x = point.x;
        position.z = point.z;
        distance -= length;
        this.cursor++;
      } else {
        position.x += (dx / length) * distance;
        position.z += (dz / length) * distance;
        distance = 0;
      }
    }
    return this.cursor >= this.path.length;
  }
  /** Straight slow move keeping the heading (forks in / out); true on arrival. */
  private creep(goal: Vector3, delta: number) {
    const position = this.carrier.position,
      dx = goal.x - position.x,
      dz = goal.z - position.z,
      length = Math.hypot(dx, dz),
      step = FORKLIFT_CONFIG.insertSpeed * delta;
    if (length > step) {
      position.x += (dx / length) * step;
      position.z += (dz / length) * step;
      return false;
    }
    position.x = goal.x;
    position.z = goal.z;
    return true;
  }
  private faceTo(heading: number) {
    this.turnTarget = heading + Math.PI * 2 * Math.round((this.carrier.rotation.y - heading) / (Math.PI * 2));
  }
  private turn(delta: number) {
    if (this.turnTarget === null) return true;
    const diff = this.turnTarget - this.carrier.rotation.y,
      step = SIMULATOR_CONFIG.amrTurnRate * delta;
    if (Math.abs(diff) <= step) {
      this.carrier.rotation.y = this.turnTarget;
      this.turnTarget = null;
      return true;
    }
    this.carrier.rotation.y += Math.sign(diff) * step;
    return false;
  }
  /** Moves the fork toward `target` lift; true once there. */
  private raise(target: number, delta: number) {
    const step = FORKLIFT_CONFIG.liftSpeed * delta;
    this.lift = Math.abs(target - this.lift) <= step ? target : this.lift + Math.sign(target - this.lift) * step;
    this.fork.position.y = FORKLIFT_CONFIG.fork.y + this.lift;
    return this.lift === target;
  }
  /** Lift that puts the fork holes level with the slot's pallet (forks slide in under the deck). */
  private get shelfLift() {
    return Math.max(0, forkLiftFor(this.target!.slotPoint.y));
  }
  advance(delta: number) {
    const job = this.job;
    if (!job || !this.stage) {
      this.turn(delta);
      return;
    }
    if (this.held && this.moving) return;
    switch (this.stage) {
      case "toPick":
        if (!this.drive(delta)) return;
        this.faceTo(this.pickHeading);
        this.stage = "alignPick";
        return;
      case "alignPick":
        // Fork to the floor (pallet holes) before driving in.
        if (this.turn(delta) && this.raise(this.pickLift, delta)) this.stage = "insertPick";
        return;
      case "insertPick":
        if (!this.creep(this.insertAt, delta)) return;
        this.attach(job.take!());
        this.stage = "liftPick";
        return;
      case "liftPick":
        if (this.raise(Math.max(FORKLIFT_CONFIG.carryLift, this.pickLift + FORKLIFT_CONFIG.clearance * (this.pickLift > 0 ? 1 : 0)), delta)) this.stage = "retreatPick";
        return;
      case "retreatPick":
        if (!this.creep(this.pickBack, delta)) return;
        if (this.job?.ready && !this.job.ready()) return;
        this.chooseOrRecover();
        return;
      case "waitTarget":
        this.timer += delta;
        if (this.timer >= RETRY_S) this.chooseOrRecover();
        return;
      case "recover": {
        if (!this.creep(this.backAt, delta)) return;
        const next = this.pending;
        this.pending = null;
        next?.();
        return;
      }
      case "toRack":
        if (!this.drive(delta)) return;
        this.tries = 0;
        this.faceTo(this.target!.heading);
        this.stage = "align";
        return;
      case "align":
        if (this.turn(delta)) this.stage = "raise";
        return;
      case "raise":
        // Storing: pallet bottom a clearance above the shelf; retrieving: fork holes level with the pallet.
        if (this.raise(this.shelfLift + (this.payload ? FORKLIFT_CONFIG.clearance : 0), delta)) this.stage = "insert";
        return;
      case "insert":
        if (!this.creep(this.insertAt, delta)) return;
        if (job.kind !== "retrieve") {
          this.stage = "place";
          return;
        }
        this.attach(job.pick!());
        this.stage = "lift";
        return;
      case "place": {
        if (!this.raise(this.shelfLift, delta)) return;
        const payload = this.payload;
        if (job.hold) {
          // Pallet stays on the forks: the owner hands its boxes to a robot, then release() takes it back.
          if (payload) job.store!(payload, this.target!);
          this.stored++;
          this.stage = "holdPlace";
          return;
        }
        this.payload = null;
        if (payload) job.store!(payload, this.target!);
        this.stored++;
        this.stage = "retreat";
        return;
      }
      case "holdPlace": {
        if (job.hold!()) return;
        const payload = this.payload;
        this.payload = null;
        if (payload) job.release?.(payload);
        this.stage = "retreat";
        return;
      }
      case "lift":
        if (this.raise(this.shelfLift + FORKLIFT_CONFIG.clearance, delta)) this.stage = "retreat";
        return;
      case "retreat":
        if (this.creep(this.target!.approach, delta)) this.stage = job.kind !== "retrieve" ? "reset" : "lower";
        return;
      case "reset":
        if (!this.raise(0, delta)) return;
        this.route(this.home, false, "returning");
        return;
      case "lower":
        if (!this.raise(FORKLIFT_CONFIG.carryLift, delta)) return;
        this.route(job.inside!, true, "toDoor");
        return;
      case "toDoor":
        if (this.drive(delta)) this.stage = "waitDoor";
        return;
      case "waitDoor":
        if (this.doorOpen) this.follow([this.carrier.position.clone(), job.outside!.clone()], "toOutside");
        return;
      case "toOutside":
        if (this.drive(delta)) this.stage = "setDown";
        return;
      case "setDown": {
        if (!this.raise(0, delta)) return;
        const payload = this.payload;
        this.payload = null;
        if (payload) job.drop!(payload);
        this.completed++;
        // Back straight off the set-down pallet by a fork length.
        const heading = this.carrier.rotation.y,
          back = FORKLIFT_CONFIG.forkLength;
        this.backAt.set(this.carrier.position.x - Math.sin(heading) * back, 0, this.carrier.position.z - Math.cos(heading) * back);
        this.stage = "backOut";
        return;
      }
      case "backOut":
        if (!this.creep(this.backAt, delta)) return;
        this.follow([this.carrier.position.clone(), job.inside!.clone()], "toInside");
        return;
      case "toInside":
        if (!this.drive(delta)) return;
        this.route(this.home, false, "returning");
        return;
      case "returning":
        if (!this.drive(delta)) return;
        this.job = null;
        this.stage = null;
        this.target = null;
        this.path = [];
        this.version++;
        this.faceTo(this.homeYaw);
        return;
    }
  }
  private attach(payload: Group | null) {
    if (!payload) return;
    this.carrier.updateWorldMatrix(true, true);
    payload.parent?.updateWorldMatrix(true, false);
    this.fork.attach(payload);
    this.payload = payload;
  }
}