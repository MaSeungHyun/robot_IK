import { Group, Vector3 } from "three";
import type { FactoryLayout } from "@/types/layout";
import { SIMULATOR_CONFIG, AMR_TRAFFIC } from "@/constants/simulatorLayout";
import { layoutPath } from "@/domain/amr/navigation/layoutNavigation";
import { RACK_CONFIG } from "@/constants/rack";
import { AMR_DECK } from "@/constants/cycle";
import { AMR_PALLET_TURN } from "@/constants/simulation";
import type { NavigationObstacle } from "@/domain/amr/navigation/layoutNavigation";

export type DispatchRoutes = {
  pickup: Vector3[];
  dispatch: Vector3[];
  returning: Vector3[];
  /** Rack delivery: `dispatch` ends in front of the slot; the AMR faces `heading`, lifts, drives in to `slot` (y = shelf), sets the pallet down and backs out. */
  store?: { slot: Vector3; heading: number };
  /** Pallet-inbound conveyor: `pickup` ends at the receive pose past the belt end; the AMR faces `heading`, waits
   * ("receiving") while the pallet rolls onto its deck, then received() starts `dispatch`. Never a floor pickup. */
  /**
   * Inbound-conveyor feed: `heading` is the exact receive yaw, `lane` a replan waypoint in front of the belt.
   * `dockGate`/`dockStage`: a loaded AMR stops `dockStage` m short of the dock until `dockGate()` (dock free & cleared).
   */
  feed?: {
heading: number; lane?: Vector3; dockGate?: () => boolean; dockStage?: number;
    /** Index in `dispatch` of a staging point off the dock lane: the gated AMR waits exactly there instead. */
    stage?: number };
  /** Unload dock: the AMR never sets the pallet down itself. It stays still at the dock, pallet on its deck, while
   * `busy()` (the dock robot depalletizes it there); then it drives back with the empty pallet and `emptyHome()` hands it off. */
  hold?: { busy: () => boolean; emptyHome: (pallet: Group, taken: () => void) => void };
};

export class PalletDispatchController {
  /** Times an AMR reached a floor pallet to lift it itself (always refused; checked by verify-pallet-modes). */
  static floorLiftAttempts = 0;
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
    | "receiving"
    | "blocked" = "idle";
  path: Vector3[] = [];
  /** End of the current leg; a traffic side-step path can end elsewhere. */
  goal: Vector3 | null = null;
  version = 0;
  yielding = false;
  /** Backing out of another AMR's way: keeps its heading and drives backward (slower). */
  reversing = false;
  /** Owner-installed clearance check for the rack insert / retreat creep (no traffic route there): false holds it. */
  guard: ((x: number, z: number) => boolean) | null = null;
  /** Waiting at the inbound queue pose for the receive pose to clear. */
  gated = false;
  get moving() {
    return (
      this.phase === "pickup" ||
      this.phase === "dispatch" ||
      this.phase === "returning"
    );
  }
  /** Carrying a pallet (decides the loaded navigation check; radii may coincide, so never compare radii). */
  get loaded() {
    return ["loading", "dispatch", "unloading", "storing"].includes(this.phase) || !!this.carried;
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
    // Gated at the dock stage or parked at a side cell: it will not move, so never predict motion
    // (a phantom forward prediction made peers stop for a vehicle that was standing still).
    if (!this.moving || this.gated || this.holding || this.turnTarget !== null) return out;
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
  /** Steps an idle, empty AMR aside for a passing vehicle (cooperative yield): it drives `points` to the free pocket,
   * holds there (traffic `holding`) and then returns to where it was parked. False when it is not idle / empty. */
  evade(points: Vector3[]) {
    if (this.phase !== "idle" || this.carried || points.length < 2) return false;
    this.goal = this.carrier.position.clone();
    this.turnTarget = null;
    this.path = points;
    this.cursor = 1;
    this.reversing = false;
    this.phase = "returning";
    this.version++;
    return true;
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
  /** Empty pallet still on the deck on the way back from a feed dock. */
  private carried: Group | null = null;
  /** In-place turn target (rad); null when not turning. */
  private turnTarget: number | null = null;
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
    return (this.phase === "idle" || this.phase === "returning") && !this.carried;
  }
  request(payload: Group, complete: () => void, routes?: DispatchRoutes) {
    if (!this.available) throw Error("AMR already has a pallet task");
    if (this.phase === "returning") {
      this.path = [];
      this.goal = null;
      this.routes = null;
      this.turnTarget = null;
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
      { axis: true },
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
  /** Docked-heading check: largest |heading − station yaw| (wrapped) seen on arrival, and arrivals counted. */
  readonly stationYaw = { arrivals: 0, maxError: 0 };
  private recordStationYaw(target: number, symmetric = false) {
    // Symmetric stations (roller transfer / robot unload) accept either end facing: error is taken modulo π.
    const d = this.carrier.rotation.y - target, k = symmetric ? 2 : 1;
    const diff = Math.atan2(Math.sin(k * d), Math.cos(k * d)) / k;
    this.stationYaw.arrivals++;
    this.stationYaw.maxError = Math.max(this.stationYaw.maxError, Math.abs(diff));
  }
  /** Nearest equivalent of `yaw + k·step` to the current heading. */
  private nearestHeading(yaw: number, step: number) {
    const current = this.carrier.rotation.y;
    return yaw + step * Math.round((current - yaw) / step);
  }
  /** Rotates in place toward turnTarget; true once aligned. */
  private turn(delta: number) {
    if (this.turnTarget === null) return true;
    // Always the shortest way round: wrap the delta into [-π, π] (turnTarget is re-based onto the current turn).
    const current = this.carrier.rotation.y,
      diff = Math.atan2(Math.sin(this.turnTarget - current), Math.cos(this.turnTarget - current)),
      step = SIMULATOR_CONFIG.amrTurnRate * delta;
    this.turnTarget = current + diff;
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
    if (this.phase === "receiving") {
      this.turn(delta);
      return;
    }
    if (this.phase === "storing") {
      this.store(delta);
      return;
    }
    const keep = this.phase === "unloading" ? this.routes?.hold?.busy : undefined;
    if (keep) {
      // Pallet stays on the deck: the dock robot takes the boxes off it; the AMR does not move or lower anything.
      if (this.complete) {
        const complete = this.complete;
        this.complete = null;
        complete();
      }
      if (keep()) return;
      this.carried = this.payload;
      this.payload = null;
      this.follow(this.routes!.returning, "returning");
      return;
    }
    if (this.phase === "loading" || this.phase === "unloading") {
      this.elapsed += delta;
      // Lift on loading; the same curve reversed lowers the pallet onto the dock.
      if (this.payload) {
        const lift = Math.min(1, this.elapsed / 0.6);
        this.payload.position.y =
          (this.phase === "loading" ? lift : 1 - lift) * AMR_DECK;
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
          // Wait at the dock square to it; the AMR is symmetric, so either end facing (shortest turn, ±π).
          this.turnTarget = this.nearestHeading(this.layout.dock.yaw, Math.PI);
          this.phase = "idle";
          this.path = [];
          this.goal = null;
          this.version++;
        }
      }
      return;
    }
    let distance = delta * SIMULATOR_CONFIG.amrSpeed;
    // Inbound feed: a loaded AMR waits at a staging distance from the unload dock until the previous AMR has
    // finished there and driven clear (no queuing right next to the dock).
    const feed = this.phase === "dispatch" ? this.routes?.feed : undefined;
    const dockEnd = this.routes?.dispatch.at(-1);
    this.gated = false;
    // The path may have been replanned around traffic, so locate the staging point in the current path.
    const stageAt = feed?.stage !== undefined ? this.routes!.dispatch[feed.stage] : undefined;
    const stage = stageAt ? this.path.findIndex((point) => point.distanceTo(stageAt) < 1e-3) : -1;
    if (feed?.dockGate && stage >= 0 && this.cursor <= stage && !feed.dockGate()) {
      // Remaining distance along the path up to the off-lane staging point.
      let left = 0, from = this.carrier.position;
      for (let i = this.cursor; i <= stage; i++) {
        left += from.distanceTo(this.path[i]);
        from = this.path[i];
      }
      if (left <= 1e-6) this.gated = true;
      else distance = Math.min(distance, left);
    } else if (feed?.dockGate && feed.stage === undefined && feed.dockStage && dockEnd && !feed.dockGate()) {
      const left = this.carrier.position.distanceTo(dockEnd);
      if (left <= feed.dockStage + 1e-6) this.gated = true;
      // Never drive past the staging circle this tick.
      else distance = Math.min(distance, left - feed.dockStage);
    }
    if (this.gated) return;
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
      // Symmetric AMR: drive whichever end is closer to the leg direction (backing up instead of a 180° spin).
      const ahead = Math.atan2(dx, dz), current = this.carrier.rotation.y;
      this.carrier.rotation.y = this.reversing ? Math.atan2(-dx, -dz) : ahead + Math.PI * Math.round((current - ahead) / Math.PI);
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
    // At the inbound conveyor's receive pose: face along the belt, then wait for the roller transfer.
    if (this.phase === "pickup" && this.routes?.feed) {
      // Roller transfer works with either end facing the belt (symmetric AMR): receive yaw or yaw ± π, whichever is nearer.
      this.turnTarget ??= this.nearestHeading(this.routes.feed.heading, Math.PI);
      if (!this.turn(delta)) return;
      this.recordStationYaw(this.routes.feed.heading, true);
      this.phase = "receiving";
      this.version++;
      return;
    }
    // At the dock: turn in place to exactly the dock's heading (shortest direction) before
    // releasing, so the pallet (held at a 90° multiple) lands square to the dock.
    if (this.phase === "dispatch") {
      const store = this.routes?.store;
      // A rack slot keeps its exact heading (lift/drive-in direction matters); a dock accepts either end (±π, shortest).
      this.turnTarget ??= store
        ? this.nearestHeading(store.heading, Math.PI * 2)
        : this.nearestHeading(this.layout.dock.yaw, Math.PI);
      if (!this.turn(delta)) return;
    }
    this.elapsed = 0;
    if (this.phase === "returning") {
      // Empty pallet ridden back from a feed dock: handed off here (e.g. to the empty-pallet forklift / stack).
      // The AMR keeps it (not available) until `taken()`: a forklift lifted it off, or it left by the return line.
      if (this.carried) {
        const pallet = this.carried;
        const hold = this.routes?.hold;
        // Square up to the home heading BEFORE offering the pallet: the forklift lifts it off along this heading.
        if (hold) {
          this.turnTarget ??= this.nearestHeading(this.layout.amr.yaw, Math.PI);
          if (!this.turn(delta)) return;
        }
        if (hold)
          hold.emptyHome(pallet, () => {
            if (this.carried !== pallet) return;
            this.carried = null;
            this.version++;
          });
        else this.carried = null;
      }
      // Settle to the home heading in place (handled while idle).
      this.turnTarget = this.nearestHeading(this.layout.amr.yaw, Math.PI);
      this.phase = "idle";
      this.path = [];
      this.goal = null;
      this.routes = null;
      this.version++;
    } else if (this.phase === "pickup") {
      // Never lift a pallet off the floor: floor pallets are put on the deck by a forklift (receive pose, routes.feed).
      PalletDispatchController.floorLiftAttempts++;
      this.phase = "blocked";
      this.version++;
      return;
    } else if (this.routes?.store) {
      this.storeFrom.copy(this.carrier.position);
      this.storeStage = "lift";
      this.recordStationYaw(this.routes.store.heading);
      this.phase = "storing";
    } else {
      this.recordStationYaw(this.layout.dock.yaw, true);
      this.phase = "unloading";
    }
  }
  /** Approach lane point in front of an inbound conveyor's receive pose (feed trips only). */
  get feedLane() {
    return this.routes?.feed?.lane ?? null;
  }
  /** Facing the belt end, square to it (receive pose reached and turned). */
  get readyToReceive() {
    return this.phase === "receiving" && this.turnTarget === null;
  }
  /** Pallet rolled onto the deck (payload already at deck height): attach it and drive the dispatch leg. */
  received() {
    if (this.phase !== "receiving" || !this.payload || !this.routes) return;
    this.carrier.updateWorldMatrix(true, true);
    this.carrier.attach(this.payload);
    this.payload.position.y = AMR_DECK;
    // Kept turned AMR_PALLET_TURN (mod 180deg) relative to the AMR heading; boxes are children and turn with it.
    this.payload.rotation.y = AMR_PALLET_TURN + Math.PI * Math.round((this.payload.rotation.y - AMR_PALLET_TURN) / Math.PI);
    this.follow(this.routes.dispatch, "dispatch");
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
      const t = length > step ? step / length : 1;
      if (this.guard && !this.guard(position.x + dx * t, position.z + dz * t)) return;
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
    if (this.gated) return "하역 위치에서 떨어진 대기 지점에서 대기 (앞 AMR 하역·이탈 중)";
    if (this.reversing) return "다른 AMR에게 길 양보 중 · 후진";
    if (this.yielding) return "다른 AMR 통과 대기 · 안전거리 확보 후 자동 출발";
    if (this.routes?.feed && this.phase === "pickup") return "입하 컨베이어 받는 위치로 이동";
    if (this.routes?.feed && this.phase === "dispatch") return "입하 팔레트 하역 위치로 운반 중";
    return {
      idle: "완성 팔레트 대기",
      pickup: "완성 팔레트 픽업 지점으로 이동",
      loading: "완성 팔레트 상차",
      dispatch: "완성 팔레트 출고 중",
      unloading: "출고 완료 처리",
      storing: "랙에 팔레트 보관 중",
      returning: "대기 위치로 복귀 중",
      receiving: "입하 컨베이어에서 팔레트 받는 중 (롤러 이송)",
      blocked: "AMR 경로가 막혔습니다. 배치를 수정해 주세요.",
    }[this.phase];
  }
}
