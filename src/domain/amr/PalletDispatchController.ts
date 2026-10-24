import { Euler, Group, Quaternion, Vector3 } from "three";
import type { FactoryLayout } from "@/types/layout";
import { SIMULATOR_CONFIG, AMR_TRAFFIC } from "@/constants/simulatorLayout";
import { layoutPath } from "@/domain/amr/navigation/layoutNavigation";
import { RACK_CONFIG } from "@/constants/rack";
import type { NavigationObstacle } from "@/domain/amr/navigation/layoutNavigation";

export type DispatchRoutes = {
  pickup: Vector3[];
  dispatch: Vector3[];
  returning: Vector3[];
  /** Rack delivery: `dispatch` ends in front of the slot; the AMR faces `heading`, lifts, drives in to `slot` (y = shelf), sets the pallet down and backs out. */
  store?: { slot: Vector3; heading: number };
};

export class PalletDispatchController {
  readonly carrier = new Group();
  readonly home: Vector3;
  phase:
    | "idle"
    | "pickup"
    | "loading"
    | "dispatch"
    | "unloading"
    | "storing"
    | "returning"
    | "blocked" = "idle";
  path: Vector3[] = [];
  /** End of the current leg; a traffic side-step path can end elsewhere. */
  goal: Vector3 | null = null;
  version = 0;
  yielding = false;
  /** Backing out of another AMR's way: keeps its heading and drives backward (slower). */
  reversing = false;
  get moving() {
    return (
      this.phase === "pickup" ||
      this.phase === "dispatch" ||
      this.phase === "returning"
    );
  }
  /** Carrying a pallet (decides the loaded navigation check; radii may coincide, so never compare radii). */
  get loaded() {
    return ["loading", "dispatch", "unloading", "storing"].includes(this.phase);
  }
  get radius() {
    return this.loaded
      ? AMR_TRAFFIC.loadedRadius
      : AMR_TRAFFIC.emptyRadius;
  }
  radiusAt(point: Vector3) {
    return this.phase === "pickup" &&
      point.distanceToSquared(
        this.goal ?? this.carrier.position,
      ) < 1e-10
      ? AMR_TRAFFIC.loadedRadius
      : this.radius;
  }
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
  /** Parked at a traffic side cell, off its goal, waiting to resume. */
  get holding() {
    return (
      this.moving &&
      this.cursor >= this.path.length &&
      !!this.goal &&
      this.carrier.position.distanceToSquared(this.goal) > 1e-8
    );
  }
  /** Remaining route from the current position, cut at `limit` metres. */
  remaining(limit = Infinity) {
    const points = [this.carrier.position.clone()];
    let travelled = 0;
    for (let i = this.cursor; i < this.path.length && travelled < limit; i++) {
      const from = points[points.length - 1],
        length = from.distanceTo(this.path[i]);
      if (travelled + length > limit) {
        points.push(from.clone().lerp(this.path[i], (limit - travelled) / length));
        break;
      }
      points.push(this.path[i].clone());
      travelled += length;
    }
    return points;
  }
  remainingLength() {
    let length = 0,
      from = this.carrier.position;
    for (let i = this.cursor; i < this.path.length; i++) {
      length += from.distanceTo(this.path[i]);
      from = this.path[i];
    }
    return length;
  }
  reroute(points: Vector3[]) {
    if (!this.moving || points.length < 2) return;
    this.path = points;
    this.cursor = 1;
    this.reversing = false;
    this.version++;
  }
  /** Like reroute, but drives the first leg backward with the current heading kept. */
  reverse(points: Vector3[]) {
    this.reroute(points);
    if (this.moving && points.length >= 2) this.reversing = true;
  }
  private layout: FactoryLayout;
  private obstacles: NavigationObstacle[] = [];
  private payload: Group | null = null;
  private complete: (() => void) | null = null;
  private cursor = 1;
  /** Index of the next waypoint on `path`; earlier points are already travelled. */
  get pathCursor() {
    return this.cursor;
  }
  private elapsed = 0;
  private routes: DispatchRoutes | null = null;
  /** In-place turn target (rad); null when not turning. */
  private turnTarget: number | null = null;
  private aligned = false;
  /** Rack storing: where the AMR stopped in front of the slot, and the current sub-step. */
  private storeFrom = new Vector3();
  private storeStage: "lift" | "insert" | "lower" | "retreat" = "lift";
  constructor(layout: FactoryLayout) {
    this.layout = layout;
    this.home = new Vector3(layout.amr.x, 0, layout.amr.z);
    this.carrier.position.set(layout.amr.x, 0, layout.amr.z);
    this.carrier.rotation.y = layout.amr.yaw;
  }
  /** Free for a new task: idle, or empty on the way home (the return leg is dropped and it heads straight to the next job). */
  get available() {
    return this.phase === "idle" || this.phase === "returning";
  }
  request(payload: Group, complete: () => void, routes?: DispatchRoutes) {
    if (!this.available) throw Error("AMR already has a pallet task");
    if (this.phase === "returning") {
      this.path = [];
      this.goal = null;
      this.routes = null;
      this.turnTarget = null;
      this.aligned = false;
      this.phase = "idle";
    }
    this.payload = payload;
    this.complete = complete;
    this.routes = routes ?? null;
    if (routes) this.follow(routes.pickup, "pickup");
    else this.route(this.layout.pallet, false, "pickup");
  }
  private get blocked() {
    return this.phase === "blocked";
  }
  /** True when parked at the home spot (within 0.3 m). */
  get atHome() {
    return Math.hypot(this.carrier.position.x - this.home.x, this.carrier.position.z - this.home.z) <= 0.3;
  }
  /** Idle away from home: drive back empty (e.g. to charge). False when no path home exists (stays idle). */
  goHome() {
    if (this.phase !== "idle" || this.atHome) return true;
    this.route(this.home, false, "returning");
    if (!this.blocked) return true;
    this.phase = "idle";
    return false;
  }
  configure(layout: FactoryLayout, obstacles: NavigationObstacle[] = []) {
    this.layout = layout;
    this.obstacles = obstacles;
  }
  private follow(
    points: Vector3[],
    phase: "pickup" | "dispatch" | "returning",
  ) {
    this.turnTarget = null;
    this.path = points;
    this.goal = points[points.length - 1]?.clone() ?? null;
    this.cursor = 1;
    this.phase = phase;
    this.version++;
  }
  private route(
    goal: { x: number; z: number },
    loaded: boolean,
    phase: "pickup" | "dispatch" | "returning",
  ) {
    this.turnTarget = null;
    const points = layoutPath(
      this.layout,
      this.carrier.position,
      goal,
      loaded,
      this.obstacles,
    );
    if (!points) {
      this.phase = "blocked";
      return;
    }
    this.path = points;
    this.goal = points[points.length - 1].clone();
    this.cursor = 1;
    this.phase = phase;
    this.version++;
  }
  /** Nearest equivalent of `yaw + k·step` to the current heading. */
  private nearestHeading(yaw: number, step: number) {
    const current = this.carrier.rotation.y;
    return yaw + step * Math.round((current - yaw) / step);
  }
  /** Rotates in place toward turnTarget; true once aligned. */
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
  advance(delta: number) {
    // Settling to the canonical home heading never blocks a new request.
    if (this.phase === "idle") {
      this.turn(delta);
      return;
    }
    if (this.phase === "blocked") return;
    if (this.phase === "storing") {
      this.store(delta);
      return;
    }
    if (this.phase === "loading" || this.phase === "unloading") {
      this.elapsed += delta;
      // Lift on loading; the same curve reversed lowers the pallet onto the dock.
      if (this.payload) {
        const lift = Math.min(1, this.elapsed / 0.6);
        this.payload.position.y =
          (this.phase === "loading" ? lift : 1 - lift) * 0.27;
      }
      if (this.elapsed < 0.6) return;
      if (this.phase === "loading") {
        if (this.routes) this.follow(this.routes.dispatch, "dispatch");
        else this.route(this.layout.dock, true, "dispatch");
      } else {
        const complete = this.complete;
        this.complete = null;
        complete?.();
        this.payload = null;
        if (this.routes) this.follow(this.routes.returning, "returning");
        else {
          // Wait at the dock axis-aligned.
          this.turnTarget = this.nearestHeading(0, Math.PI / 2);
          this.phase = "idle";
          this.path = [];
      this.goal = null;
          this.goal = null;
          this.version++;
        }
      }
      return;
    }
    let distance = delta * SIMULATOR_CONFIG.amrSpeed;
    while (distance > 0 && this.cursor < this.path.length) {
      const point = this.path[this.cursor],
        position = this.carrier.position;
      const dx = point.x - position.x,
        dz = point.z - position.z,
        length = Math.hypot(dx, dz);
      if (length < 1e-8) {
        this.cursor++;
        continue;
      }
      // A carried pallet is parented to the carrier (attached at pickup with its
      // relative pose preserved), so it and its boxes turn with the AMR.
      // Reversing keeps the heading while the leg points backward; once the yield path bends away it turns and drives forward.
      if (this.reversing) {
        const yaw = this.carrier.rotation.y;
        if (-(Math.sin(yaw) * dx + Math.cos(yaw) * dz) / length < 0.5) this.reversing = false;
      }
      this.carrier.rotation.y = this.reversing ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
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
    if (this.cursor >= this.path.length) this.reversing = false;
    if (this.cursor < this.path.length || this.holding) return;
    // Under the pallet: align with it (square pallet, so any 90° equivalent) before lifting.
    if (this.phase === "pickup" && this.payload) {
      if (this.turnTarget === null && !this.aligned) {
        const yaw = new Euler().setFromQuaternion(
          this.payload.getWorldQuaternion(new Quaternion()),
          "YXZ",
        ).y;
        this.turnTarget = this.nearestHeading(yaw, Math.PI / 2);
      }
      if (!this.turn(delta)) return;
      this.aligned = true;
    }
    // At the dock: turn in place to the nearest 90° of the dock's heading before
    // releasing, so the pallet (held at a 90° multiple) lands square to the dock.
    if (this.phase === "dispatch") {
      const store = this.routes?.store;
      // A rack slot is entered head-on; a dock accepts any 90° heading.
      this.turnTarget ??= store
        ? this.nearestHeading(store.heading, Math.PI * 2)
        : this.nearestHeading(this.layout.dock.yaw, Math.PI / 2);
      if (!this.turn(delta)) return;
    }
    this.elapsed = 0;
    if (this.phase === "returning") {
      // Settle to the home heading in place (handled while idle).
      this.turnTarget = this.nearestHeading(this.layout.amr.yaw, Math.PI * 2);
      this.phase = "idle";
      this.path = [];
      this.goal = null;
      this.routes = null;
      this.version++;
    } else if (this.phase === "pickup") {
      this.carrier.updateWorldMatrix(true, true);
      this.carrier.attach(this.payload!);
      // Remove residual skew: the relative yaw is an exact multiple of 90°.
      const payload = this.payload!;
      payload.rotation.y = (Math.PI / 2) * Math.round(payload.rotation.y / (Math.PI / 2));
      this.aligned = false;
      this.phase = "loading";
    } else if (this.routes?.store) {
      this.storeFrom.copy(this.carrier.position);
      this.storeStage = "lift";
      this.phase = "storing";
    } else this.phase = "unloading";
  }
  /** Lift to the shelf, drive in, set the pallet down (complete), back out, then return home. */
  private store(delta: number) {
    const store = this.routes!.store!,
      payload = this.payload,
      position = this.carrier.position;
    const toward = (value: number, target: number, step: number) =>
      Math.abs(target - value) <= step ? target : value + Math.sign(target - value) * step;
    if (this.storeStage === "lift") {
      if (payload) {
        const height = store.slot.y + RACK_CONFIG.liftClearance;
        payload.position.y = toward(payload.position.y, height, RACK_CONFIG.liftSpeed * delta);
        if (payload.position.y !== height) return;
      }
      this.storeStage = "insert";
      return;
    }
    if (this.storeStage === "insert" || this.storeStage === "retreat") {
      const goal = this.storeStage === "insert" ? store.slot : this.storeFrom;
      const dx = goal.x - position.x,
        dz = goal.z - position.z,
        length = Math.hypot(dx, dz),
        step = RACK_CONFIG.insertSpeed * delta;
      if (length > step) {
        position.x += (dx / length) * step;
        position.z += (dz / length) * step;
        return;
      }
      position.x = goal.x;
      position.z = goal.z;
      if (this.storeStage === "insert") this.storeStage = "lower";
      else this.follow(this.routes!.returning, "returning");
      return;
    }
    if (payload) {
      payload.position.y = toward(payload.position.y, store.slot.y, RACK_CONFIG.liftSpeed * delta);
      if (payload.position.y !== store.slot.y) return;
    }
    const complete = this.complete;
    this.complete = null;
    complete?.();
    this.payload = null;
    this.storeStage = "retreat";
  }
  get status() {
    if (this.reversing) return "다른 AMR에게 길 양보 중 · 후진";
    if (this.yielding) return "다른 AMR 통과 대기 · 안전거리 확보 후 자동 출발";
    return {
      idle: "완성 팔레트 대기",
      pickup: "완성 팔레트 픽업 지점으로 이동",
      loading: "완성 팔레트 상차",
      dispatch: "완성 팔레트 출고 중",
      unloading: "출고 완료 처리",
      storing: "랙에 팔레트 보관 중",
      returning: "대기 위치로 복귀 중",
      blocked: "AMR 경로가 막혔습니다. 배치를 수정해 주세요.",
    }[this.phase];
  }
}
