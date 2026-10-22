import { Group, Vector3 } from "three";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { RACK_CONFIG } from "@/constants/rack";

/**
 * Dedicated rack-unloading AMR (temporary stand-in for a real rack outfeed; replaceable as a unit).
 * Drives to a rack's loading face, takes one stored pallet out of its slot, carries it out through
 * a door to a point just outside, drops it (it leaves the scene), comes back in and returns home.
 * Everything advances by the fixed simulation step only, so runs are identical at any playback speed.
 */
export type RackUnloadJob = {
  rackId: string;
  slot: number;
  /** Floor point in front of the slot, the slot's PalletPoint (y = shelf) and the heading facing into the rack. */
  approach: Vector3;
  slotPoint: Vector3;
  heading: number;
  doorId: string;
  /** Floor points just inside and just outside the door opening. */
  inside: Vector3;
  outside: Vector3;
  /** Called at the slot: returns the stored pallet group (with its boxes) to carry, or null if gone. */
  pick: () => Group | null;
  /** Called once the pallet has been set down outside; the owner removes it from the scene. */
  drop: (payload: Group) => void;
};

/** Plans a floor route; null when no route exists (the controller then goes straight). */
export type RackAMRPlanner = (from: Vector3, to: Vector3, loaded: boolean) => Vector3[] | null;

type Stage =
  | "toRack" | "align" | "insert" | "lift" | "retreat" | "lower"
  | "toDoor" | "waitDoor" | "toOutside" | "drop" | "toInside" | "returning";

const CARRY_HEIGHT = 0.27;
const DROP_SECONDS = 0.6;

const STATUS: Record<Stage, string> = {
  toRack: "랙으로 이동 중",
  align: "랙 반출 위치 정렬",
  insert: "랙 칸으로 진입",
  lift: "랙에서 팔레트 인출",
  retreat: "랙에서 후진",
  lower: "팔레트 운반 자세",
  toDoor: "팔레트 반출 · 문으로 이동 중",
  waitDoor: "문 열림 대기",
  toOutside: "문 밖으로 반출 중",
  drop: "문 밖에 팔레트 하차",
  toInside: "공장 안으로 복귀 중",
  returning: "대기 위치로 복귀 중",
};

export class RackAMRController {
  readonly carrier = new Group();
  readonly home: Vector3;
  private readonly homeYaw: number;
  job: RackUnloadJob | null = null;
  stage: Stage | null = null;
  payload: Group | null = null;
  path: Vector3[] = [];
  private cursor = 1;
  version = 0;
  private timer = 0;
  private turnTarget: number | null = null;
  /** Set by the owner each step: whether the job's door is fully open. */
  doorOpen = false;
  completed = 0;
  private readonly plan: RackAMRPlanner;
  constructor(pose: { x: number; z: number; yaw: number }, plan: RackAMRPlanner) {
    this.plan = plan;
    this.home = new Vector3(pose.x, 0, pose.z);
    this.homeYaw = pose.yaw;
    this.carrier.position.copy(this.home);
    this.carrier.rotation.y = pose.yaw;
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
    return this.stage === "toDoor" || this.stage === "waitDoor" || this.stage === "toOutside" || this.stage === "drop" || this.stage === "toInside";
  }
  get loaded() {
    return this.payload !== null;
  }
  get status() {
    return this.stage ? STATUS[this.stage] : "랙 반출 대기";
  }
  /** Starts a job; false (nothing changes) when the rack face can't be reached. */
  start(job: RackUnloadJob) {
    if (this.job) return false;
    const route = this.plan(this.carrier.position, job.approach, false);
    if (!route) return false;
    this.job = job;
    this.follow(route, "toRack");
    return true;
  }
  private follow(points: Vector3[], stage: Stage) {
    this.path = points;
    this.cursor = 1;
    this.stage = stage;
    this.version++;
  }
  private route(to: Vector3, loaded: boolean, stage: Stage) {
    const from = this.carrier.position.clone();
    this.follow(this.plan(from, to, loaded) ?? [from, to.clone()], stage);
  }
  /** Moves along `path`; true once its end is reached. */
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
  /** Straight slow move (into / out of the rack slot); true on arrival. */
  private creep(goal: Vector3, delta: number) {
    const position = this.carrier.position,
      dx = goal.x - position.x,
      dz = goal.z - position.z,
      length = Math.hypot(dx, dz),
      step = RACK_CONFIG.insertSpeed * delta;
    if (length > step) {
      position.x += (dx / length) * step;
      position.z += (dz / length) * step;
      return false;
    }
    position.x = goal.x;
    position.z = goal.z;
    return true;
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
  private raise(target: number, delta: number) {
    const payload = this.payload;
    if (!payload) return true;
    const step = RACK_CONFIG.liftSpeed * delta,
      value = payload.position.y;
    payload.position.y = Math.abs(target - value) <= step ? target : value + Math.sign(target - value) * step;
    return payload.position.y === target;
  }
  advance(delta: number) {
    const job = this.job;
    if (!job || !this.stage) {
      this.turn(delta);
      return;
    }
    switch (this.stage) {
      case "toRack":
        if (!this.drive(delta)) return;
        {
          const current = this.carrier.rotation.y;
          this.turnTarget = job.heading + Math.PI * 2 * Math.round((current - job.heading) / (Math.PI * 2));
        }
        this.stage = "align";
        return;
      case "align":
        if (this.turn(delta)) this.stage = "insert";
        return;
      case "insert":
        if (!this.creep(job.slotPoint, delta)) return;
        {
          const payload = job.pick();
          if (payload) {
            this.carrier.updateWorldMatrix(true, false);
            payload.parent?.updateWorldMatrix(true, false);
            this.carrier.attach(payload);
            this.payload = payload;
          }
        }
        this.stage = "lift";
        return;
      case "lift":
        // Carrier-local y equals world y (the carrier sits on the floor).
        if (this.raise(job.slotPoint.y + RACK_CONFIG.liftClearance, delta)) this.stage = "retreat";
        return;
      case "retreat":
        if (this.creep(job.approach, delta)) this.stage = "lower";
        return;
      case "lower":
        if (!this.raise(CARRY_HEIGHT, delta)) return;
        this.route(job.inside, true, "toDoor");
        return;
      case "toDoor":
        if (this.drive(delta)) this.stage = "waitDoor";
        return;
      case "waitDoor":
        if (this.doorOpen) this.follow([this.carrier.position.clone(), job.outside.clone()], "toOutside");
        return;
      case "toOutside":
        if (!this.drive(delta)) return;
        this.timer = 0;
        this.stage = "drop";
        return;
      case "drop": {
        this.timer += delta;
        if (this.payload) this.payload.position.y = CARRY_HEIGHT * Math.max(0, 1 - this.timer / DROP_SECONDS);
        if (this.timer < DROP_SECONDS) return;
        const payload = this.payload;
        this.payload = null;
        if (payload) job.drop(payload);
        this.completed++;
        this.follow([this.carrier.position.clone(), job.inside.clone()], "toInside");
        return;
      }
      case "toInside":
        if (!this.drive(delta)) return;
        this.route(this.home, false, "returning");
        return;
      case "returning":
        if (!this.drive(delta)) return;
        this.job = null;
        this.stage = null;
        this.path = [];
        this.version++;
        this.turnTarget = this.homeYaw + Math.PI * 2 * Math.round((this.carrier.rotation.y - this.homeYaw) / (Math.PI * 2));
        return;
    }
  }
}
