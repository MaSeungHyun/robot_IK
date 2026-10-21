import { Euler, Group, Quaternion, Vector3 } from "three";
import type { FactoryLayout } from "@/types/layout";
import { SIMULATOR_CONFIG, AMR_TRAFFIC } from "@/constants/simulatorLayout";
import { layoutPath } from "@/domain/amr/navigation/layoutNavigation";
import type { NavigationObstacle } from "@/domain/amr/navigation/layoutNavigation";

export type DispatchRoutes = {
  pickup: Vector3[];
  dispatch: Vector3[];
  returning: Vector3[];
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
    | "returning"
    | "blocked" = "idle";
  path: Vector3[] = [];
  /** End of the current leg; a traffic side-step path can end elsewhere. */
  goal: Vector3 | null = null;
  version = 0;
  yielding = false;
  get moving() {
    return (
      this.phase === "pickup" ||
      this.phase === "dispatch" ||
      this.phase === "returning"
    );
  }
  get radius() {
    return ["loading", "dispatch", "unloading"].includes(this.phase)
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
    this.version++;
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
  constructor(layout: FactoryLayout) {
    this.layout = layout;
    this.home = new Vector3(layout.amr.x, 0, layout.amr.z);
    this.carrier.position.set(layout.amr.x, 0, layout.amr.z);
    this.carrier.rotation.y = layout.amr.yaw;
  }
  request(payload: Group, complete: () => void, routes?: DispatchRoutes) {
    if (this.phase !== "idle") throw Error("AMR already has a pallet task");
    this.payload = payload;
    this.complete = complete;
    this.routes = routes ?? null;
    if (routes) this.follow(routes.pickup, "pickup");
    else this.route(this.layout.pallet, false, "pickup");
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
    phase: "pickup" | "dispatch",
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
    if (this.phase === "loading" || this.phase === "unloading") {
      this.elapsed += delta;
      if (this.phase === "loading" && this.payload)
        this.payload.position.y = Math.min(1, this.elapsed / 0.6) * 0.27;
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
    } else this.phase = "unloading";
  }
  get status() {
    if (this.yielding) return "다른 AMR 통과 대기 · 안전거리 확보 후 자동 출발";
    return {
      idle: "완성 팔레트 대기",
      pickup: "완성 팔레트 픽업 지점으로 이동",
      loading: "완성 팔레트 상차",
      dispatch: "완성 팔레트 출고 중",
      unloading: "출고 완료 처리",
      returning: "대기 위치로 복귀 중",
      blocked: "AMR 경로가 막혔습니다. 배치를 수정해 주세요.",
    }[this.phase];
  }
}
