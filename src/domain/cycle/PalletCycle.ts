import { Euler, Group, Vector3 } from "three";
import type { EquipmentSettings, SceneEquipment } from "@/types/layout";
import type { CargoRegistry } from "@/domain/cargo/CargoRegistry";
import type { PalletController } from "@/domain/pallet/PalletController";
import { beginPlanningStep, CycleVehicle, type CycleBody } from "@/domain/cycle/CycleVehicle";
import {
  AGV_STATES, FORKLIFT_JOBS, FORKLIFT_TASK_STATES, RACK_M_STATES, SHUTTLE_STATES,
  type AgvState, type ForkliftJobKind, type ForkliftTaskState, type RackMState, type ShuttleState,
} from "@/domain/cycle/cycleStates";
import { AGV_MODEL, CYCLE_CONFIG, RACK_M_MODEL, ROLLER_DECK } from "@/constants/cycle";
import { FORKLIFT_CIRCLES, FORKLIFT_CONFIG, forkLiftFor, forkliftStop } from "@/constants/forklift";
import { RACK_CONFIG, rackHeading, rackSlotPoint } from "@/constants/rack";
import { STREAM_CONFIG } from "@/constants/simulation";
import { createAgvModel, createRackMobileModel, createRollerTopModel } from "@/lib/three/cycleModels";
import { palletFeeds, receivePose } from "@/domain/cycle/palletFeed";
import { beltLength, beltPoint } from "@/domain/conveyor/conveyorLayout";
import { autoSpawns, beltSpeedOf, spawnIntervalOf } from "@/domain/simulation/equipmentSpeeds";
import { doesGeneralJobs, emptyByForkliftOf, stackCapacityOf, takesEmptyPallets } from "@/constants/emptyPallet";

/**
 * Pallet cycle orchestrator (scenes with shuttle AMRs / AGVs):
 * 1. 입하: a palletizing robot loads boxes onto the pallet on a shuttle AMR (pallet mounted on it).
 * 2. 스캔: the full shuttle drives to an unload dock; the scanner-side depalletizing robot puts the
 *    boxes on the (fed) scan conveyor; the empty pallet rides back and is loaded again.
 * 3. 스캔 후 재적재: the robot at the scan line end loads a second shuttle; when full it drives to the
 *    service dock where the service forklift moves the full pallet into a Rack_m level and puts a
 *    new empty pallet from the pallet source back on the shuttle.
 * 4. A full Rack_m is lifted by an AGV and carried to the rack zone drop point; the rack forklift
 *    stores its pallets into the Rack, the AGV brings the empty Rack_m back. The rack forklift also
 *    takes stored pallets out to the outbound stage dock, where the outbound depalletizing robot puts
 *    the boxes one by one on the ship conveyor (출하 완료 at its end).
 * Variants (per-model settings, defaults keep the flow above):
 * - Pallet-unit inbound shuttle with emptyPallet "forklift": after the scanner robot emptied it, the AMR waits at the unload
 *   dock, the cell's service forklift lifts the empty pallet off and stacks it on the empty-pallet source, then the AMR goes
 *   back (deck empty) for the next loaded pallet.
 * - Carrier forklift (forkliftTask "carrier"): holds the pallet in front of its forks while the robot loads it, carries the
 *   full pallet to an unload dock (deliver link or nearest), waits there with the pallet on its forks while the depalletizing
 *   robot unloads it, and brings the empty pallet back to the loading robot.
 * Each actor has an explicit state machine (cycleStates.ts); transitions are logged.
 * The factory provides scene services through PalletCycleHost (no React / stores here).
 */
export type CycleCargo = { id: string; node: Group };
export type CycleCircle = { x: number; z: number; r: number };
export type PalletCycleHost<C extends CycleCargo> = {
  readonly root: Group;
  readonly cargo: CargoRegistry;
  elapsed(): number;
  settings(): Record<string, EquipmentSettings>;
  plan(from: Vector3, to: Vector3, loaded: boolean, extra: readonly CycleCircle[]): Vector3[] | null;
  render(group: Group): void;
  unrender(group: Group): void;
  /** New empty pallet group (pallet model), rendered, not parented. */
  newPallet(): Group;
  /** Placed boxes of pallet station `stationId` leave the factory box list (they ride with the pallet). */
  takePlaced(stationId: string): C[];
  /** Pallet-unit inbound: a new loaded pallet (boxes at `pallet`'s slot layout, pallet-local), rendered, not parented. */
  loadedPallet(beltId: string, pallet: PalletController): { group: Group; boxes: C[] };
  /** Records the boxes of a loaded pallet that rolled onto station `stationId` (cargo history). */
  registerLoaded(stationId: string, boxes: C[]): void;
  /** Boxes that arrived on an inbound pallet: they must pass a scanner before shipping. */
  inboundFed?(boxes: C[]): void;
  /** Hands `boxes` (top first) on `group` to the depalletizers at `dock`; `keep` leaves the group in place when emptied. */
  unload(dock: SceneEquipment, group: Group, boxes: C[], palletId: string | undefined, keep: boolean, onEmpty: () => void): void;
  unloadBusy(dockId: string): boolean;
  /** Free rack slots (lowest first) excluding `booked` keys "rack:slot". */
  rackFree(booked: ReadonlySet<string>, accept?: (rack: SceneEquipment) => boolean): { rack: SceneEquipment; slot: number } | null;
  rackStore(rack: SceneEquipment, slot: number, group: Group, boxes: Group[], palletId: string | undefined): void;
  /** Oldest stored rack pallet that is not claimed. */
  rackOldest(claimed: ReadonlySet<string>, accept?: (rack: SceneEquipment) => boolean): { rack: SceneEquipment; slot: number } | null;
  rackTake(rack: SceneEquipment, slot: number): Group | null;
  log(level: "info" | "warning", message: string, detail?: string): void;
};

type Load<C> = { group: Group; boxes: C[]; palletId?: string };
type Shuttle<C> = {
  object: SceneEquipment;
  vehicle: CycleVehicle;
  pallet: PalletController;
  mode: "scan" | "service";
  dock: SceneEquipment;
  state: ShuttleState;
  home: Vector3;
  homeYaw: number;
  load: Load<C> | null;
  trips: number;
  /** Pallet-unit inbound feeding this (roller-top) shuttle. */
  feed: Feed<C> | null;
  /** Feed shuttles only: the emptied pallet is collected by the service forklift (emptyPallet "forklift"). */
  emptyByForklift: boolean;
};
type Feed<C> = {
  belt: SceneEquipment;
  timer: number;
  incoming: { group: Group; boxes: C[]; distance: number } | null;
  /** Boxes of the pallet on the deck (no robot placed them). */
  deck: C[] | null;
  fed: number;
  emptyReturned: number;
};
type RackM<C> = {
  object: SceneEquipment;
  group: Group;
  bay: { x: number; z: number; yaw: number };
  state: RackMState;
  levels: (Load<C> | null)[];
  /** Level booked by a forklift on its way. */
  booked: Set<number>;
  agv: Agv | null;
  fills: number;
};
type Agv = { object: SceneEquipment; vehicle: CycleVehicle; lift: Group; state: AgvState; home: Vector3; homeYaw: number; trips: number };
/** Empty-pallet source stack; `busy` = the forklift reserving it (one at a time). */
type Source = { dock: SceneEquipment; top: Group; stack: Group[]; busy?: Forklift<unknown> | null };
type Forklift<C> = {
  object: SceneEquipment;
  vehicle: CycleVehicle;
  task: "service" | "rack" | "carrier";
  state: ForkliftTaskState;
  job: ForkliftJobKind | null;
  home: Vector3;
  homeYaw: number;
  carrying: Load<C> | null;
  lastJob: ForkliftJobKind | null;
  done: number;
  /** Carrier forklifts: the pallet held on the forks, its loading station pose and target unload dock. */
  carrier: { pallet: PalletController; heading: number; dock: SceneEquipment | null } | null;
};
export type CycleSnapshotItem = { id: string; kind: "shuttle" | "forklift" | "agv" | "rackm"; state: string; label: string; detail: string };
export type CycleStats = {
  /** Service forklifts: summed busy seconds, and seconds with ≥ 2 of them busy at once (parallel split work). */
  forkliftBusy: number;
  forkliftOverlap: number;
  scanTrips: number;
  serviceTrips: number;
  swaps: number;
  rackMFull: number;
  agvTrips: number;
  storedToRack: number;
  shippedPallets: number;
  overrides: number;
  fallbacks: number;
  /** Pallet-unit inbound: loaded pallets rolled onto AMRs / empty pallets rolled off to the return line. */
  palletsFed: number;
  emptyReturned: number;
  /** Empty pallets lifted off inbound AMRs by a forklift and stacked on the pallet source. */
  emptyStacked: number;
  /** Full pallets carried by carrier forklifts to an unload dock (and emptied there). */
  carrierTrips: number;
};

const forward = (yaw: number) => new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
/** Fork heading along a pallet's axis (pallets are 180° symmetric), nearest the preferred approach heading. */
const alongPallet = (palletYaw: number, near: number) => palletYaw + Math.PI * Math.round((near - palletYaw) / Math.PI);
const yawOf = (group: Group) => new Euler().setFromQuaternion(group.getWorldQuaternion(group.quaternion.clone()), "YXZ").y;
const AMR_CIRCLES = [{ z: -0.42, r: 0.84 }, { z: 0.42, r: 0.84 }];
const FORK_CIRCLES = FORKLIFT_CIRCLES.map((z) => ({ z, r: FORKLIFT_CONFIG.footprint.radius }));
/** Tines + gap kept between the Forklift_point and the support edge before driving in. */
const FORK_BACK = FORKLIFT_CONFIG.forkLength + CYCLE_CONFIG.standoffGap;
const VEHICLE_APPROACH = 1.9;
/** Carrier forklift: max distance (m) from its Forklift_point to the pallet it holds. */
const CARRIER_REACH = 1.0;

export class PalletCycle<C extends CycleCargo> {
  readonly shuttles: Shuttle<C>[] = [];
  /** Owned shuttles left out of the cycle (no pallet / dock): drawn standing still. */
  private readonly parked: CycleVehicle[] = [];
  readonly forklifts: Forklift<C>[] = [];
  readonly agvs: Agv[] = [];
  readonly racks: RackM<C>[] = [];
  private readonly sources: Source[] = [];
  private drops: SceneEquipment[] = [];
  private stages: SceneEquipment[] = [];
  /** Drop points / stage docks in use. */
  private readonly busyDocks = new Set<string>();
  /**
   * Cycle cell of each object: index of the nearest service dock (0 without one). Several cells in one scene run
   * independently: forklifts, AGVs, Rack_m, drop points, stages, sources and racks only work within their cell.
   */
  private readonly cells = new Map<string, number>();
  private cellOf(id: string) {
    return this.cells.get(id) ?? 0;
  }
  private slotBookings = new Set<string>();
  private shipClaims = new Set<string>();
  /** Boxes (cargo) of pallets stored in the big rack by this cycle, by "rack:slot". */
  private stored = new Map<string, Load<C>>();
  private readonly bodies: CycleBody[] = [];
  private readonly host: PalletCycleHost<C>;
  /** AMR ↔ forklift pallet handoff accuracy: max jump (m / rad) of the pallet when it is set onto / remounted on / picked from an AMR. */
  readonly handoff = { count: 0, xz: 0, y: 0, yaw: 0, pickXz: 0, pickY: 0, pickYaw: 0 };
  /** Fork target vs the pallet actually on the AMR when the forks lift it (heading = forklift heading). */
  private measurePick(group: Group, point: Vector3, heading: number) {
    group.updateWorldMatrix(true, false);
    const p = group.getWorldPosition(new Vector3()), d = yawOf(group) - heading;
    const h = this.handoff;
    h.pickXz = Math.max(h.pickXz, Math.hypot(p.x - point.x, p.z - point.z));
    h.pickY = Math.max(h.pickY, Math.abs(p.y - point.y));
    h.pickYaw = Math.max(h.pickYaw, Math.abs(Math.atan2(Math.sin(2 * d), Math.cos(2 * d))) / 2);
  }
  private measure(group: Group, run: () => void) {
    group.updateWorldMatrix(true, false);
    const p0 = group.getWorldPosition(new Vector3()), y0 = yawOf(group);
    run();
    group.updateWorldMatrix(true, false);
    const p1 = group.getWorldPosition(new Vector3()), y1 = yawOf(group);
    // Pallets are 180° symmetric for the forks: compare headings modulo π.
    const dyaw = Math.abs(Math.atan2(Math.sin(2 * (y1 - y0)), Math.cos(2 * (y1 - y0)))) / 2;
    const h = this.handoff;
    h.count++;
    h.xz = Math.max(h.xz, Math.hypot(p1.x - p0.x, p1.z - p0.z));
    h.y = Math.max(h.y, Math.abs(p1.y - p0.y));
    h.yaw = Math.max(h.yaw, dyaw);
  }
  readonly stats: CycleStats = { forkliftBusy: 0, forkliftOverlap: 0, scanTrips: 0, serviceTrips: 0, swaps: 0, rackMFull: 0, agvTrips: 0, storedToRack: 0, shippedPallets: 0, overrides: 0, fallbacks: 0, palletsFed: 0, emptyReturned: 0, emptyStacked: 0, carrierTrips: 0 };

  /** Equipment the cycle owns (the factory skips them); null when the scene has no cycle. */
  /** Pallet-inbound belts served by a receiving shuttle in this cycle (others are held at their stopper by the simulator). */
  readonly feedBelts = new Set<string>();
  static owned(objects: readonly SceneEquipment[], settings: Record<string, EquipmentSettings>) {
    const cycle = objects.some((o) => o.kind === "amr" && (settings[o.id]?.amrRole === "shuttle" || settings[o.id]?.amrRole === "agv"
      || (settings[o.id]?.amrRole === "forklift" && settings[o.id]?.forkliftTask === "carrier")));
    if (!cycle) return null;
    return new Set(objects.filter((o) =>
      (o.kind === "amr" && (["shuttle", "agv"].includes(settings[o.id]?.amrRole ?? "") || (settings[o.id]?.forkliftTask && settings[o.id]?.amrRole === "forklift")))
      || (o.kind === "rack" && settings[o.id]?.rackType === "mobile")).map((o) => o.id));
  }

  constructor(
    objects: readonly SceneEquipment[],
    pallets: readonly PalletController[],
    host: PalletCycleHost<C>,
    deliverTo: (palletId: string) => readonly string[],
    feedTo: (beltId: string) => readonly string[] = () => [],
  ) {
    this.host = host;
    const settings = host.settings();
    const docks = objects.filter((o) => o.kind === "dock");
    const role = (o: SceneEquipment) => settings[o.id]?.dockRole;
    const services = docks.filter((d) => role(d) === "service");
    const gap = (a: SceneEquipment, b: SceneEquipment) => Math.hypot(a.x - b.x, a.z - b.z);
    for (const o of objects) this.cells.set(o.id, services.reduce((best, d, i) => (gap(o, d) < gap(o, services[best]) ? i : best), 0));
    this.drops = docks.filter((d) => role(d) === "rackDrop");
    this.stages = docks.filter((d) => role(d) === "stage");
    for (const sourceDock of docks.filter((d) => role(d) === "palletSource")) {
      const stack = Array.from({ length: CYCLE_CONFIG.sourceStack - 1 }, (_, i) => this.placeStatic(this.host.newPallet(), sourceDock, i * STREAM_CONFIG.palletHeight));
      this.sources.push({ dock: sourceDock, stack, top: this.placeStatic(this.host.newPallet(), sourceDock, (CYCLE_CONFIG.sourceStack - 1) * STREAM_CONFIG.palletHeight) });
    }
    // Grid searches are the heaviest part of a step (a vehicle's approach-ring fallback alone runs dozens of them), and
    // the same leg is asked for again and again (home <-> station, retries while held). Memoise by the exact query:
    // start/goal/obstacles rounded to 1 cm, so a moved rack or another body is a different key.
    const memo = new Map<string, Vector3[] | null>();
    const r = (v: number) => Math.round(v * 100);
    const plan = (loaded: boolean) => (from: Vector3, to: Vector3, _loaded?: boolean, avoid: readonly CycleCircle[] = []) => {
      const obstacles = [...this.rackObstacles(from, to), ...avoid];
      const key = `${+loaded}|${r(from.x)},${r(from.z)}|${r(to.x)},${r(to.z)}|${obstacles.map((o) => `${r(o.x)},${r(o.z)},${r(o.r)}`).join(";")}`;
      if (memo.has(key)) return memo.get(key)?.slice() ?? null;
      const route = this.host.plan(from, to, loaded, obstacles);
      if (memo.size >= 4000) memo.clear();
      memo.set(key, route ? route.map((p) => p.clone()) : null);
      return route;
    };
    const bodies = () => this.bodies;
    const feeds = palletFeeds(objects, settings, feedTo);
    for (const object of objects) {
      const config = settings[object.id];
      if (object.kind === "amr" && config?.amrRole === "shuttle") {
        const pallet = pallets.find((p) => settings[p.object.id]?.mountedOn === object.id);
        const park = () => this.parked.push(new CycleVehicle(object.id, object.name, object, { speed: 0, circles: AMR_CIRCLES, clearance: CYCLE_CONFIG.amrClearance, plan: plan(false), bodies }));
        if (!pallet) {
          host.log("warning", `${object.name}: 올려진 팔레트가 없어 셔틀 순환에서 제외`);
          park();
          continue;
        }
        const targets = deliverTo(pallet.object.id).map((id) => docks.find((d) => d.id === id)).filter((d): d is SceneEquipment => !!d);
        const candidates = targets.length ? targets : docks.filter((d) => role(d) === "unload" || role(d) === "service");
        const dock = candidates.sort((a, b) => Math.hypot(a.x - object.x, a.z - object.z) - Math.hypot(b.x - object.x, b.z - object.z))[0];
        if (!dock) {
          host.log("warning", `${object.name}: 하역/교체 위치(dock)가 없어 셔틀 순환에서 제외`);
          park();
          continue;
        }
        const vehicle = new CycleVehicle(object.id, object.name, object, { speed: CYCLE_CONFIG.shuttleSpeed, circles: AMR_CIRCLES, clearance: CYCLE_CONFIG.amrClearance, plan: plan(true), bodies });
        pallet.managed = true;
        const belt = feeds.get(object.id);
        const feed: Feed<C> | null = belt ? { belt, timer: spawnIntervalOf(settings[belt.id] ?? {}), incoming: null, deck: null, fed: 0, emptyReturned: 0 } : null;
        if (feed) {
          this.feedBelts.add(belt!.id);
          // Roller-top AMR: the deck starts empty, loaded pallets come from the inbound belt.
          vehicle.carrier.add(createRollerTopModel());
          this.host.unrender(pallet.group);
          pallet.group.removeFromParent();
          pallet.shipping = true;
        } else this.mount(vehicle, pallet, pallet.group, object.yaw);
        // Feed shuttle: its home is the receive pose at the belt end (unless already parked there); an empty AMR parked
        // elsewhere drives there first while the first pallet runs up to the belt-end stopper.
        const receive = belt ? receivePose(belt) : null;
        const atReceive = !receive || Math.hypot(object.x - receive.x, object.z - receive.z) <= CYCLE_CONFIG.feedReach;
        const home = receive && !atReceive ? new Vector3(receive.x, 0, receive.z) : new Vector3(object.x, 0, object.z);
        const homeYaw = receive && !atReceive ? receive.yaw : object.yaw;
        const shuttle: Shuttle<C> = { object, vehicle, pallet, mode: role(dock) === "service" ? "service" : "scan", dock, state: feed ? (atReceive ? "waitPallet" : "toReceive") : "loading", home, homeYaw, load: null, trips: 0, feed, emptyByForklift: !!feed && emptyByForkliftOf(settings[object.id]) };
        this.shuttles.push(shuttle);
        if (feed && !atReceive)
          vehicle.goTo(home).turn(homeYaw).then(() => {
            vehicle.carrier.position.copy(home);
            vehicle.carrier.rotation.y = homeYaw;
            this.setShuttle(shuttle, "waitPallet", "받는 위치 도착");
          });
        this.bodies.push(vehicle.body);
      } else if (object.kind === "amr" && config?.amrRole === "agv") {
        const { root, lift } = createAgvModel();
        const vehicle = new CycleVehicle(object.id, object.name, object, {
          speed: AGV_MODEL.speed,
          circles: [{ z: 0, r: AGV_MODEL.radius }],
          loadedCircles: [{ z: 0, r: RACK_M_MODEL.radius }],
          clearance: CYCLE_CONFIG.amrClearance,
          plan: plan(true),
          bodies,
          fork: { group: lift, rest: lift.position.y, speed: AGV_MODEL.liftSpeed },
        });
        // The lift plate (AGV.Lift) is the vehicle's "fork" group, reparented onto the carrier.
        vehicle.carrier.add(root);
        this.agvs.push({ object, vehicle, lift, state: "idle", home: new Vector3(object.x, 0, object.z), homeYaw: object.yaw, trips: 0 });
        this.bodies.push(vehicle.body);
      } else if (object.kind === "amr" && config?.amrRole === "forklift" && config.forkliftTask) {
        const fork = new Group();
        fork.position.copy(FORKLIFT_CONFIG.fork);
        const vehicle = new CycleVehicle(object.id, object.name, object, {
          speed: CYCLE_CONFIG.forkliftSpeed,
          circles: FORK_CIRCLES,
          plan: plan(false),
          bodies,
          fork: { group: fork, rest: FORKLIFT_CONFIG.fork.y, speed: CYCLE_CONFIG.forkSpeed },
        });
        const forklift: Forklift<C> = { object, vehicle, task: config.forkliftTask, state: "idle", job: null, home: new Vector3(object.x, 0, object.z), homeYaw: object.yaw, carrying: null, lastJob: null, done: 0, carrier: null };
        if (config.forkliftTask === "carrier") this.setupCarrier(forklift, pallets, docks, deliverTo);
        this.forklifts.push(forklift);
        this.bodies.push(vehicle.body);
      } else if (object.kind === "rack" && config?.rackType === "mobile") {
        const group = new Group();
        group.add(createRackMobileModel());
        group.position.set(object.x, 0, object.z);
        group.rotation.y = object.yaw;
        group.userData.sceneId = object.id;
        host.root.add(group);
        this.racks.push({ object, group, bay: { x: object.x, z: object.z, yaw: object.yaw }, state: "filling", levels: RACK_M_MODEL.levels.map(() => null), booked: new Set(), agv: null, fills: 0 });
      }
    }
    // AMRs never lift a pallet off the floor: every empty pallet onto a shuttle deck is placed by a service forklift.
    for (const shuttle of this.shuttles)
      if (shuttle.mode === "service" && !this.forklifts.some((f) => f.task === "service" && this.cellOf(f.object.id) === this.cellOf(shuttle.dock.id)))
        host.log("warning", `${shuttle.object.name}: 서비스 지게차가 없어 빈 팔레트를 올려줄 수 없음`, "AMR은 바닥의 팔레트를 스스로 들지 못합니다. 같은 구역에 서비스 지게차를 두세요");
  }

  /**
   * Carrier forklift: takes the free pallet in front of its forks (within CARRIER_REACH of the Forklift_point), snaps to the
   * exact pose that holds that pallet where it was placed (the loading robot's slots stay valid) and picks its unload dock.
   */
  private setupCarrier(f: Forklift<C>, pallets: readonly PalletController[], docks: readonly SceneEquipment[], deliverTo: (palletId: string) => readonly string[]) {
    const { object, vehicle } = f, settings = this.host.settings();
    // forkliftStop(target, h) = target - fork offset(h), so with h + π it gives object + offset(yaw): the Forklift_point.
    const point = forkliftStop(new Vector3(object.x, 0, object.z), object.yaw + Math.PI, 0);
    const taken = new Set(this.forklifts.map((other) => other.carrier?.pallet.object.id));
    const pallet = pallets
      .filter((p) => !p.managed && !settings[p.object.id]?.mountedOn && !taken.has(p.object.id))
      .map((p) => ({ p, d: Math.hypot(p.object.x - point.x, p.object.z - point.z) }))
      .filter(({ d }) => d <= CARRIER_REACH)
      .sort((a, b) => a.d - b.d)[0]?.p;
    if (!pallet) {
      this.host.log("warning", `${object.name}: 포크 앞에 팔레트가 없어 운반 지게차 순환에서 제외`, "팔레트를 지게차 포크 바로 앞에 두세요");
      return;
    }
    const linked = deliverTo(pallet.object.id).map((id) => docks.find((d) => d.id === id)).filter((d): d is SceneEquipment => !!d);
    const role = (d: SceneEquipment) => settings[d.id]?.dockRole;
    const near = (list: SceneEquipment[]) => list.sort((a, b) => Math.hypot(a.x - pallet.object.x, a.z - pallet.object.z) - Math.hypot(b.x - pallet.object.x, b.z - pallet.object.z))[0];
    const dock = (linked.length ? near(linked) : near(docks.filter((d) => role(d) === "unload"))) ?? null;
    if (!dock) this.host.log("warning", `${object.name}: 하역 위치(dock)가 없어 팔레트를 든 채 대기`);
    const heading = alongPallet(pallet.object.yaw, object.yaw);
    const pose = forkliftStop(new Vector3(pallet.object.x, 0, pallet.object.z), heading, 0);
    vehicle.carrier.position.copy(pose);
    vehicle.carrier.rotation.y = heading;
    f.home = pose.clone();
    f.homeYaw = heading;
    vehicle.fork!.position.y = FORKLIFT_CONFIG.fork.y + forkLiftFor(pallet.baseY);
    vehicle.carrier.updateWorldMatrix(true, true);
    this.attachTo(vehicle.fork!, pallet.group);
    pallet.managed = true;
    vehicle.loaded = true;
    f.carrier = { pallet, heading, dock };
    this.setForklift(f, "holdLoading");
  }
  /**
   * Empty pallet handed back by the simulator (unload-dock AMR hold) or a roller-top feed shuttle: stacked on the nearest
   * pallet source (empty-pallet stack) so the service forklift recirculates it. false: no source in the layout.
   */
  stackEmpty(group: Group, at: Vector3): boolean {
    const free = this.sources.filter((s) => !s.busy);
    const pool = free.length ? free : this.sources;
    if (!pool.length) return false;
    const gap = (s: Source) => Math.hypot(s.dock.x - at.x, s.dock.z - at.z);
    const source = pool.reduce((best, s) => (gap(s) < gap(best) ? s : best));
    group.removeFromParent();
    this.stats.emptyStacked++;
    if (source.stack.length + 2 > this.stackMax(source)) {
      // Stack full: taken away (infinite store), the stack keeps its height.
      this.host.unrender(group);
      return true;
    }
    this.placeStatic(group, source.dock, source.top.position.y + STREAM_CONFIG.palletHeight);
    source.stack.push(source.top);
    source.top = group;
    return true;
  }
  /** Nearest empty-pallet stack's next drop point (on its top pallet), for a forklift bringing an empty pallet. */
  emptyStackDrop(at: Vector3, linked: readonly string[] = []): { point: Vector3; yaw: number; id: string } | null {
    const pool = this.sources.filter((s) => linked.includes(s.dock.id));
    const sources = pool.length ? pool : this.sources;
    if (!sources.length) return null;
    const gap = (s: Source) => Math.hypot(s.dock.x - at.x, s.dock.z - at.z);
    const source = sources.reduce((best, s) => (gap(s) < gap(best) ? s : best));
    return { point: source.top.position.clone().setY(source.top.position.y + STREAM_CONFIG.palletHeight), yaw: source.dock.yaw, id: source.dock.id };
  }
  /** Pallets a source stack holds (dock setting stackCapacity, default 8). */
  private stackMax(source: Source) {
    return stackCapacityOf(this.host.settings()[source.dock.id]);
  }
  private placeStatic(group: Group, dock: SceneEquipment, y: number) {
    group.position.set(dock.x, y, dock.z);
    group.rotation.set(0, dock.yaw, 0);
    this.host.root.add(group);
    return group;
  }
  /** Stationary Rack_m frames as planner obstacles (except racks at the trip ends). */
  private rackObstacles(from: Vector3, to: Vector3): CycleCircle[] {
    const out: CycleCircle[] = [];
    for (const rack of this.racks) {
      if (rack.group.parent !== this.host.root) continue;
      const p = rack.group.position;
      if (Math.hypot(p.x - from.x, p.z - from.z) < 1.4 || Math.hypot(p.x - to.x, p.z - to.z) < 1.4) continue;
      out.push({ x: p.x, z: p.z, r: RACK_M_MODEL.radius });
    }
    return out;
  }
  private now() {
    return this.host.elapsed();
  }
  private enabled(id: string) {
    return this.host.settings()[id]?.enabled !== false;
  }

  private setShuttle(shuttle: Shuttle<C>, state: ShuttleState, detail = "") {
    if (shuttle.state === state) return;
    shuttle.state = state;
    this.host.log("info", `${shuttle.object.name} → ${SHUTTLE_STATES[state]}`, detail || undefined);
  }
  private setRack(rack: RackM<C>, state: RackMState) {
    if (rack.state === state) return;
    rack.state = state;
    this.host.log("info", `${rack.object.name} → ${RACK_M_STATES[state]}`);
  }
  private setAgv(agv: Agv, state: AgvState) {
    if (agv.state === state) return;
    agv.state = state;
    this.host.log("info", `${agv.object.name} → ${AGV_STATES[state]}`);
  }
  private setForklift(forklift: Forklift<C>, state: ForkliftTaskState) {
    if (forklift.state === state) return;
    forklift.state = state;
    if (state === "idle" || state === "toPick" || state === "waitTarget")
      this.host.log("info", `${forklift.object.name} → ${FORKLIFT_TASK_STATES[state]}`, forklift.job ? FORKLIFT_JOBS[forklift.job] : undefined);
  }

  /** Pallet group onto a shuttle deck at the pallet station orientation; resets the station. */
  private mount(vehicle: CycleVehicle, pallet: PalletController, group: Group, homeYaw: number) {
    vehicle.carrier.updateWorldMatrix(true, false);
    vehicle.carrier.add(group);
    group.position.set(0, pallet.baseY, 0);
    group.rotation.set(0, pallet.object.yaw - homeYaw, 0);
    pallet.mount(group);
    vehicle.loaded = true;
  }
  private attachTo(parent: Group, group: Group) {
    parent.updateWorldMatrix(true, false);
    group.parent?.updateWorldMatrix(true, false);
    parent.attach(group);
  }

  advance(dt: number) {
    beginPlanningStep();
    for (const shuttle of this.shuttles) {
      if (shuttle.feed) this.advanceFeed(shuttle, shuttle.feed, dt);
      this.advanceShuttle(shuttle);
    }
    for (const agv of this.agvs) this.advanceAgv(agv);
    for (const forklift of this.forklifts) this.advanceForklift(forklift);
    const busy = this.forklifts.filter((f) => f.task === "service" && f.job).length;
    this.stats.forkliftBusy += busy * dt;
    if (busy >= 2) this.stats.forkliftOverlap += dt;
    for (const vehicle of this.vehicles()) if (this.enabled(vehicle.id)) vehicle.advance(dt);
    let overrides = 0, fallbacks = 0;
    for (const vehicle of this.vehicles()) {
      overrides += vehicle.overrides;
      fallbacks += vehicle.fallbacks;
    }
    this.stats.overrides = overrides;
    this.stats.fallbacks = fallbacks;
  }
  /** Vehicles to render (the view adds AMR.glb / Forklift.glb to each carrier; the AGV and roller top are already built in). */
  get views(): readonly { id: string; kind: "shuttle" | "agv" | "forklift"; vehicle: CycleVehicle }[] {
    return [
      ...this.shuttles.map((s) => ({ id: s.object.id, kind: "shuttle" as const, vehicle: s.vehicle })),
      ...this.parked.map((vehicle) => ({ id: vehicle.id, kind: "shuttle" as const, vehicle })),
      ...this.agvs.map((a) => ({ id: a.vehicle.id, kind: "agv" as const, vehicle: a.vehicle })),
      ...this.forklifts.map((f) => ({ id: f.vehicle.id, kind: "forklift" as const, vehicle: f.vehicle })),
    ];
  }
  /** Rack_m groups (owned by the cycle; drawn by FactoryRun as their own selectable objects). */
  get rackViews(): readonly { id: string; group: Group }[] {
    return this.racks.map((r) => ({ id: r.object.id, group: r.group }));
  }
  private *vehicles() {
    for (const s of this.shuttles) yield s.vehicle;
    for (const a of this.agvs) yield a.vehicle;
    for (const f of this.forklifts) yield f.vehicle;
  }

  // ---------------------------------------------------------------- shuttle AMR
  private advanceShuttle(shuttle: Shuttle<C>) {
    const { pallet } = shuttle;
    if (shuttle.state === "loading" || shuttle.state === "waitDock") {
      if (!pallet.full || !this.enabled(shuttle.object.id)) return;
      if (shuttle.mode === "scan" && (this.host.unloadBusy(shuttle.dock.id)
        || this.shuttles.some((s) => s !== shuttle && s.dock === shuttle.dock && (s.state === "waitEmptyPick" || s.state === "emptyPicking")))) {
        this.setShuttle(shuttle, "waitDock");
        return;
      }
      if (shuttle.mode === "service" && this.shuttles.some((s) => s !== shuttle && s.dock === shuttle.dock && s.state !== "loading" && s.state !== "waitDock")) {
        this.setShuttle(shuttle, "waitDock");
        return;
      }
      this.depart(shuttle);
    }
  }
  /**
   * Pallet-unit inbound: a loaded pallet spawns on the belt every spawn interval (one on the belt at a
   * time), runs to the belt end stopper and, once the roller-top shuttle is docked with an empty deck,
   * rolls on at belt speed (roller surface = belt surface, ROLLER_DECK).
   */
  private advanceFeed(shuttle: Shuttle<C>, feed: Feed<C>, dt: number) {
    const config = this.host.settings()[feed.belt.id];
    if (!config?.enabled) return;
    feed.timer += dt;
    if (!autoSpawns(config)) feed.timer = 0;
    else if (!feed.incoming && feed.timer >= spawnIntervalOf(config)) {
      feed.timer = 0;
      const { group, boxes } = this.host.loadedPallet(feed.belt.id, shuttle.pallet);
      this.host.root.add(group);
      feed.incoming = { group, boxes, distance: STREAM_CONFIG.palletDepth / 2 };
      this.host.log("info", `${feed.belt.name}: 입하 팔레트 투입`, `박스 ${boxes.length}`);
    }
    const incoming = feed.incoming;
    if (!incoming) return;
    const length = beltLength(feed.belt), end = beltPoint(feed.belt, length);
    const transfer = length + Math.hypot(shuttle.home.x - end.x, shuttle.home.z - end.z);
    const ready = shuttle.state === "waitPallet" || shuttle.state === "rollOn";
    const limit = ready ? transfer : length - STREAM_CONFIG.palletDepth / 2;
    if (ready && shuttle.state === "waitPallet" && incoming.distance >= length - STREAM_CONFIG.palletDepth / 2 - 1e-6) this.setShuttle(shuttle, "rollOn");
    incoming.distance = Math.min(incoming.distance + beltSpeedOf(config) * dt, limit);
    const along = Math.min(incoming.distance, length), point = beltPoint(feed.belt, along), extra = incoming.distance - along;
    incoming.group.position.set(point.x + Math.sin(point.yaw) * extra, ROLLER_DECK, point.z + Math.cos(point.yaw) * extra);
    incoming.group.rotation.set(0, point.yaw, 0);
    if (!ready || incoming.distance < transfer - 1e-6) return;
    // On the deck: the loaded pallet becomes the shuttle's pallet load.
    const { pallet, vehicle } = shuttle;
    vehicle.carrier.add(incoming.group);
    incoming.group.position.set(0, pallet.baseY, 0);
    incoming.group.rotation.set(0, point.yaw - shuttle.homeYaw, 0);
    pallet.mount(incoming.group);
    pallet.loadAll(this.now());
    vehicle.loaded = true;
    this.host.registerLoaded(pallet.object.id, incoming.boxes);
    this.host.inboundFed?.(incoming.boxes);
    feed.deck = incoming.boxes;
    feed.incoming = null;
    feed.fed++;
    this.stats.palletsFed++;
    this.setShuttle(shuttle, "loading", `입하 팔레트 · 박스 ${incoming.boxes.length}`);
  }
  private depart(shuttle: Shuttle<C>) {
    const { pallet, vehicle, dock } = shuttle, t = this.now();
    const record = this.host.cargo.currentPallet(pallet.object.id)?.id;
    this.host.cargo.completePallet({ t, stationId: pallet.object.id });
    if (record) this.host.cargo.dispatchPallet({ t, palletId: record, amrId: shuttle.object.id, destinationId: dock.id });
    pallet.shipping = true;
    const fed = shuttle.feed?.deck;
    if (shuttle.feed) shuttle.feed.deck = null;
    const boxes = (fed ?? this.host.takePlaced(pallet.object.id)).sort((a, b) => b.node.getWorldPosition(new Vector3()).y - a.node.getWorldPosition(new Vector3()).y);
    shuttle.load = { group: pallet.group, boxes, palletId: record };
    shuttle.trips++;
    const goal = new Vector3(dock.x, 0, dock.z);
    if (shuttle.mode === "scan") {
      this.stats.scanTrips++;
      this.setShuttle(shuttle, "toUnload", `${record ?? ""} · 박스 ${boxes.length}`);
      vehicle.goTo(goal).turn(dock.yaw).then(() => {
        if (record) this.host.cargo.arrivePallet({ t: this.now(), palletId: record, dockId: dock.id });
        this.setShuttle(shuttle, "unloading");
        const load = shuttle.load!;
        this.host.unload(dock, load.group, load.boxes, load.palletId, true, () => {
          if (shuttle.emptyByForklift && this.canCollectEmpty(shuttle)) {
            // The empty pallet stays on the deck until the service forklift lifts it off (serviceJob → takeEmpty).
            shuttle.load = { group: load.group, boxes: [] };
            this.setShuttle(shuttle, "waitEmptyPick");
            return;
          }
          shuttle.load = null;
          this.setShuttle(shuttle, "returning");
          this.goHome(shuttle, load.group);
        });
      });
    } else {
      this.stats.serviceTrips++;
      this.setShuttle(shuttle, "toService", `${record ?? ""} · 박스 ${boxes.length}`);
      vehicle.goTo(goal).turn(dock.yaw).then(() => this.setShuttle(shuttle, "waitSwap"));
    }
  }
  /** A service forklift and a pallet source in the shuttle's cell (else the empty pallet goes back as with emptyPallet "return"). */
  private canCollectEmpty(shuttle: Shuttle<C>) {
    const cell = this.cellOf(shuttle.dock.id);
    const ok = this.forklifts.some((f) => f.task === "service" && this.cellOf(f.object.id) === cell && takesEmptyPallets(this.host.settings()[f.object.id]))
      && this.sources.some((s) => this.cellOf(s.dock.id) === cell);
    if (!ok) this.host.log("warning", `${shuttle.object.name}: 서비스 지게차나 빈 팔레트 적치장이 없어 빈 팔레트를 반송 라인으로 보냄`);
    return ok;
  }
  /** `group` null: the empty pallet was already taken off by a forklift (feed shuttles only). */
  private goHome(shuttle: Shuttle<C>, group: Group | null) {
    shuttle.vehicle.goTo(shuttle.home).then(() => this.setShuttle(shuttle, "docking")).turn(shuttle.homeYaw).then(() => {
      // Exact station pose: the robot's slot points are fixed in the world.
      shuttle.vehicle.carrier.position.copy(shuttle.home);
      shuttle.vehicle.carrier.rotation.y = shuttle.homeYaw;
      if (shuttle.feed) {
        // Roller-top: the empty pallet rolls off to the empty-pallet return line (not modelled), the deck waits for the next loaded pallet.
        if (group) {
          // No service forklift could lift it off: it rolls off to the return line (not modelled). Never placed on the
          // source stack without a forklift.
          this.host.unrender(group);
          group.removeFromParent();
          shuttle.feed.emptyReturned++;
          this.stats.emptyReturned++;
        }
        shuttle.vehicle.loaded = false;
        const settings = this.host.settings()[shuttle.pallet.object.id];
        this.host.cargo.startPallet({ t: this.now(), stationId: shuttle.pallet.object.id, grade: settings?.grade ?? "normal" });
        this.setShuttle(shuttle, "waitPallet", group ? "빈 팔레트 반송" : "지게차가 빈 팔레트 회수");
        return;
      }
      if (!group) return;
      this.measure(group, () => this.mount(shuttle.vehicle, shuttle.pallet, group, shuttle.homeYaw));
      const settings = this.host.settings()[shuttle.pallet.object.id];
      this.host.cargo.startPallet({ t: this.now(), stationId: shuttle.pallet.object.id, grade: settings?.grade ?? "normal" });
      this.setShuttle(shuttle, "loading");
    });
  }

  // ---------------------------------------------------------------- AGV + Rack_m
  private advanceAgv(agv: Agv) {
    if (agv.state !== "idle" || !agv.vehicle.idle || !this.enabled(agv.object.id)) return;
    const cell = this.cellOf(agv.object.id);
    const drop = this.drops.find((d) => this.cellOf(d.id) === cell && !this.busyDocks.has(d.id));
    const rack = drop && this.racks.find((r) => r.state === "waitAgv" && !r.agv && this.cellOf(r.object.id) === cell);
    if (!drop || !rack) return;
    rack.agv = agv;
    this.busyDocks.add(drop.id);
    const v = agv.vehicle;
    const bay = new Vector3(rack.bay.x, 0, rack.bay.z), bayIn = bay.clone().addScaledVector(forward(rack.bay.yaw), -VEHICLE_APPROACH);
    const at = new Vector3(drop.x, 0, drop.z), dropIn = at.clone().addScaledVector(forward(drop.yaw), -VEHICLE_APPROACH);
    this.setAgv(agv, "toRack");
    v.goTo(bayIn, false).turn(rack.bay.yaw).straight(bay, { speed: 0.6 })
      .then(() => {
        this.setAgv(agv, "lifting");
        this.attachTo(agv.lift, rack.group);
      })
      .forkTo(AGV_MODEL.liftStroke)
      .then(() => {
        v.loaded = true;
        this.setAgv(agv, "toDrop");
        this.setRack(rack, "transit");
      })
      .goTo(dropIn, true).turn(drop.yaw).straight(at, { speed: 0.6 })
      .then(() => this.setAgv(agv, "lowering"))
      .forkTo(0)
      .then(() => {
        this.attachTo(this.host.root, rack.group);
        rack.group.position.set(at.x, 0, at.z);
        rack.group.rotation.set(0, drop.yaw + (rack.object.yaw - rack.bay.yaw), 0);
        v.loaded = false;
        this.setAgv(agv, "waitEmpty");
        this.setRack(rack, "unloading");
      })
      .until(() => rack.levels.every((l) => !l) && !rack.booked.size)
      .then(() => {
        this.setAgv(agv, "toBay");
        this.setRack(rack, "returning");
        this.attachTo(agv.lift, rack.group);
      })
      .forkTo(AGV_MODEL.liftStroke)
      .then(() => {
        v.loaded = true;
      })
      .straight(dropIn, { backward: true, speed: 0.6 })
      .then(() => {
        this.busyDocks.delete(drop.id);
      })
      .goTo(bayIn, true).turn(rack.bay.yaw).straight(bay, { speed: 0.6 })
      .then(() => this.setAgv(agv, "lowering"))
      .forkTo(0)
      .then(() => {
        this.attachTo(this.host.root, rack.group);
        rack.group.position.set(rack.bay.x, 0, rack.bay.z);
        rack.group.rotation.set(0, rack.bay.yaw, 0);
        v.loaded = false;
        rack.agv = null;
        this.setRack(rack, "filling");
        this.setAgv(agv, "returning");
        agv.trips++;
        this.stats.agvTrips++;
      })
      .straight(bayIn, { backward: true, speed: 0.6 })
      .goTo(agv.home, false).turn(agv.homeYaw)
      .then(() => this.setAgv(agv, "idle"));
  }

  // ---------------------------------------------------------------- forklifts
  /** Drives to the standoff of a support (pallet bottom centre `point`, heading `heading`) and lifts the pallet. */
  private pick(f: Forklift<C>, point: Vector3, heading: number, back: number, take: () => Load<C> | null, ignore: string[], clearance: number = CYCLE_CONFIG.forkClearance) {
    const v = f.vehicle;
    const stand = forkliftStop(point, heading, back + FORK_BACK), inPose = forkliftStop(point, heading, 0);
    v.goTo(stand, !!f.carrying, ignore).turn(heading)
      .then(() => this.setForklift(f, "pickUp"))
      .forkTo(forkLiftFor(point.y))
      .straight(inPose, { ignore })
      .then(() => {
        const load = take();
        if (!load) return;
        f.carrying = load;
        this.attachTo(v.fork!, load.group);
        v.loaded = true;
      })
      .forkTo(forkLiftFor(point.y) + clearance)
      .straight(stand, { backward: true, ignore })
      .forkTo(Math.max(FORKLIFT_CONFIG.carryLift, forkLiftFor(0) + FORKLIFT_CONFIG.carryLift))
      .then(() => this.setForklift(f, "carry"));
  }
  /** Sets the carried pallet down with its bottom centre at `point` (inverse of pick). */
  private place(f: Forklift<C>, point: Vector3, heading: number, back: number, release: (load: Load<C>) => void, ignore: string[], after?: () => void, clearance: number = CYCLE_CONFIG.forkClearance) {
    const v = f.vehicle;
    const stand = forkliftStop(point, heading, back + FORK_BACK), inPose = forkliftStop(point, heading, 0);
    v.goTo(stand, true, ignore).turn(heading)
      .then(() => this.setForklift(f, "putDown"))
      .forkTo(forkLiftFor(point.y) + clearance)
      .straight(inPose, { ignore })
      .forkTo(forkLiftFor(point.y))
      .then(() => {
        const load = f.carrying;
        f.carrying = null;
        v.loaded = false;
        if (load) release(load);
      })
      .straight(stand, { backward: true, ignore })
      .then(() => after?.())
      .forkTo(0);
  }
  private finish(f: Forklift<C>) {
    f.vehicle.then(() => {
      f.done++;
      f.lastJob = f.job;
      f.job = null;
      this.setForklift(f, f.task === "carrier" ? "holdLoading" : "idle");
    });
  }
  private returnHome(f: Forklift<C>) {
    f.vehicle.then(() => this.setForklift(f, "returning")).goTo(f.home, false).turn(f.homeYaw);
  }

  private advanceForklift(f: Forklift<C>) {
    if (f.job || !f.vehicle.idle || !this.enabled(f.object.id)) return;
    if (f.task === "service") {
      this.serviceJob(f);
      if (!f.job) this.yieldOrPark(f);
      if (!f.job && f.vehicle.idle && f.state !== "idle" && f.state !== "returning") this.setForklift(f, "idle");
      return;
    }
    else if (f.task === "carrier") this.carrierJob(f);
    else this.rackJob(f);
    if (f.task === "carrier") return;
    if (!f.job && f.state !== "idle" && f.state !== "returning") this.setForklift(f, "idle");
  }
  /**
   * Idle service forklift: steps aside when it stands in a moving forklift's way (its home is on the shared AMR-side
   * approach); drives home only once no other service forklift of the cell is working (service jobs end in place).
   */
  private yieldOrPark(f: Forklift<C>) {
    const cell = this.cellOf(f.object.id), here = f.vehicle.position;
    const others = this.forklifts.filter((o) => o !== f && o.task === "service" && this.cellOf(o.object.id) === cell);
    const blocked = others.find((o) => !o.vehicle.idle && o.vehicle.held >= CYCLE_CONFIG.yieldAfter && o.vehicle.position.distanceTo(here) < CYCLE_CONFIG.yieldRange);
    if (blocked) {
      const dx = here.x - blocked.vehicle.position.x, dz = here.z - blocked.vehicle.position.z, len = Math.hypot(dx, dz) || 1;
      // Side step away from the blocked forklift's line plus a little back off.
      const side = Math.sign(-dz * (here.x - f.home.x) + dx * (here.z - f.home.z)) || 1;
      const aside = new Vector3(here.x + (dx / len) * 1.5 + (-dz / len) * side * CYCLE_CONFIG.yieldStep, 0, here.z + (dz / len) * 1.5 + (dx / len) * side * CYCLE_CONFIG.yieldStep);
      this.setForklift(f, "returning");
      f.vehicle.goTo(aside, false).then(() => this.setForklift(f, "idle"));
      return;
    }
    if (here.distanceTo(f.home) > 0.3 && others.every((o) => !o.job)) {
      this.returnHome(f);
      f.vehicle.then(() => this.setForklift(f, "idle"));
    }
  }
  /**
   * Service forklift job queue (per cell). Jobs: unload (full pallet AMR → Rack_m), supply (empty pallet source → AMR) and
   * takeEmpty (empty pallet off an inbound AMR → source). Reservations: a shuttle is claimed by state, a Rack_m level by
   * `booked`, the empty-pallet source stack by `busy` (one forklift at the stack). With two forklifts one supplies the empty
   * pallet while the other carries the full one to Rack_m; a lone "auto" forklift chains both (no extra trip home).
   */
  private serviceJob(f: Forklift<C>) {
    const cell = this.cellOf(f.object.id);
    const role = this.host.settings()[f.object.id]?.forkliftRole ?? "auto";
    // "emptyReturn": only empty pallets off inbound AMRs → source.
    const canUnload = role !== "supply" && role !== "emptyReturn", canSupply = role !== "unload" && role !== "emptyReturn", canTakeEmpty = role !== "unload";
    const inCell = (s: Shuttle<C>) => this.cellOf(s.dock.id) === cell;
    const source = this.sources.find((s) => this.cellOf(s.dock.id) === cell && !s.busy);
    // 1. An AMR whose full pallet is already off waits for its empty pallet: shortest AMR downtime first.
    const needsEmpty = this.shuttles.find((s) => s.mode === "service" && s.state === "waitEmpty" && inCell(s));
    if (canSupply && needsEmpty && source) {
      this.supplyJob(f, needsEmpty, source);
      return;
    }
    const empty = this.shuttles.find((s) => s.state === "waitEmptyPick" && s.load && inCell(s));
    const swapWaiting = this.shuttles.some((s) => s.mode === "service" && s.state === "waitSwap" && inCell(s));
    // Alternate with swaps when both wait so neither side starves.
    if (canTakeEmpty && empty && source && (!swapWaiting || !canUnload || f.lastJob !== "takeEmpty")) {
      this.takeEmptyJob(f, empty, source);
      return;
    }
    const shuttle = this.shuttles.find((s) => s.mode === "service" && s.state === "waitSwap" && inCell(s));
    if (!canUnload || !shuttle || !shuttle.load || !this.sources.some((s) => this.cellOf(s.dock.id) === cell)) return;
    const rack = this.racks.find((r) => r.state === "filling" && this.cellOf(r.object.id) === cell && r.levels.some((l, i) => !l && !r.booked.has(i)));
    if (!rack) {
      if (f.state !== "waitTarget") {
        f.job = null;
        this.setForklift(f, "waitTarget");
      }
      return;
    }
    // Another forklift in the cell may supply the empty pallet: hand it over, otherwise chain the supply.
    const helper = this.forklifts.some((o) => o !== f && o.task === "service" && this.cellOf(o.object.id) === cell && this.enabled(o.object.id)
      && (this.host.settings()[o.object.id]?.forkliftRole ?? "auto") !== "unload" && doesGeneralJobs(this.host.settings()[o.object.id]));
    this.unloadJob(f, shuttle, rack, !helper);
  }
  /** Full pallet off a waiting shuttle into a free Rack_m level; `chain`: then supply its empty pallet in the same job. */
  private unloadJob(f: Forklift<C>, shuttle: Shuttle<C>, rack: RackM<C>, chain: boolean) {
    const level = rack.levels.findIndex((l, i) => !l && !rack.booked.has(i));
    rack.booked.add(level);
    f.job = "swapFull";
    this.setShuttle(shuttle, "swapping");
    this.setForklift(f, "toPick");
    // Approach along the pallet actually on the AMR (its world yaw), not the dock's nominal yaw.
    shuttle.load!.group.updateWorldMatrix(true, false);
    const heading = alongPallet(yawOf(shuttle.load!.group), shuttle.dock.yaw);
    const deck = shuttle.vehicle.position.clone().setY(shuttle.pallet.baseY);
    const half = STREAM_CONFIG.palletDepth / 2;
    this.pick(f, deck, heading, half, () => {
      if (shuttle.load) this.measurePick(shuttle.load.group, deck, heading);
      return shuttle.load;
    }, [shuttle.object.id]);
    // Full pallet lifted off and forks backed out: the AMR is free for an empty pallet (another forklift may bring it now).
    if (!chain) f.vehicle.then(() => this.setShuttle(shuttle, "waitEmpty", "만재 팔레트 내림"));
    const rackPoint = new Vector3(rack.group.position.x, RACK_M_MODEL.levels[level], rack.group.position.z);
    const rackFacing = rackHeading({ x: rack.group.position.x, z: rack.group.position.z, yaw: rack.group.rotation.y });
    this.place(f, rackPoint, rackFacing, RACK_M_MODEL.width / 2, (load) => {
      this.attachTo(rack.group, load.group);
      load.group.position.set(0, RACK_M_MODEL.levels[level], 0);
      load.group.rotation.set(0, (Math.PI / 2) * Math.round((yawOf(load.group) - rack.group.rotation.y) / (Math.PI / 2)), 0);
      rack.levels[level] = load;
      rack.booked.delete(level);
      shuttle.load = null;
    }, [], () => {
      if (rack.levels.every((l) => l)) {
        rack.fills++;
        this.stats.rackMFull++;
        this.setRack(rack, "waitAgv");
      }
    });
    if (chain) {
      const source = this.sources.find((s) => this.cellOf(s.dock.id) === this.cellOf(shuttle.dock.id));
      if (source) {
        this.supplySteps(f, shuttle, source);
        return;
      }
    }
    this.finish(f);
  }
  /** Empty pallet from the source stack onto a shuttle whose full pallet is already off. */
  private supplyJob(f: Forklift<C>, shuttle: Shuttle<C>, source: Source) {
    this.setShuttle(shuttle, "swapping", "빈 팔레트 공급");
    this.supplySteps(f, shuttle, source);
  }
  private supplySteps(f: Forklift<C>, shuttle: Shuttle<C>, source: Source) {
    const half = STREAM_CONFIG.palletDepth / 2;
    f.vehicle.then(() => {
      f.job = "swapEmpty";
      source.busy = f;
      this.setForklift(f, "toSource");
    });
    if (!f.job) {
      f.job = "swapEmpty";
      source.busy = f;
    }
    const top = source.top.position.clone();
    this.pick(f, top, source.dock.yaw, half, () => {
      const group = source.top;
      source.top = this.placeStatic(this.host.newPallet(), source.dock, top.y);
      return { group, boxes: [] };
    }, []);
    // Stack reservation released once the forks are out of the stack.
    f.vehicle.then(() => { if (source.busy === f) source.busy = null; });
    const seatYaw = shuttle.vehicle.carrier.rotation.y + shuttle.pallet.object.yaw - shuttle.homeYaw;
    const back = shuttle.vehicle.position.clone().setY(shuttle.pallet.baseY);
    this.place(f, back, alongPallet(seatYaw, shuttle.dock.yaw), half, (load) => {
      this.measure(load.group, () => {
        this.attachTo(shuttle.vehicle.carrier, load.group);
        load.group.position.set(0, shuttle.pallet.baseY, 0);
        load.group.rotation.set(0, shuttle.pallet.object.yaw - shuttle.homeYaw, 0);
      });
      shuttle.pallet.mount(load.group);
      // Closed to the station robot until the shuttle is back at its exact home pose (goHome remounts).
      shuttle.pallet.shipping = true;
      this.stats.swaps++;
    }, [shuttle.object.id], () => {
      this.setShuttle(shuttle, "returning");
      this.goHome(shuttle, shuttle.pallet.group);
    });
    this.finish(f);
  }
  /** Service forklift: empty pallet off an inbound (roller-top) AMR at its unload dock → top of the empty-pallet source stack. */
  private takeEmptyJob(f: Forklift<C>, shuttle: Shuttle<C>, source: Source) {
    f.job = "takeEmpty";
    source.busy = f;
    this.setShuttle(shuttle, "emptyPicking");
    this.setForklift(f, "toPick");
    const group = shuttle.load!.group;
    group.updateWorldMatrix(true, false);
    const deck = shuttle.vehicle.position.clone().setY(shuttle.pallet.baseY);
    const half = STREAM_CONFIG.palletDepth / 2;
    // Either end of the pallet axis: the one whose standoff is nearer the forklift.
    const along = alongPallet(yawOf(group), shuttle.dock.yaw), from = f.vehicle.position;
    const heading = [along, along + Math.PI]
      .map((h) => ({ h, d: forkliftStop(deck, h, half + FORK_BACK).distanceTo(from) }))
      .sort((a, b) => a.d - b.d)[0].h;
    this.pick(f, deck, heading, half, () => {
      const load = shuttle.load;
      if (load) this.measurePick(load.group, deck, heading);
      shuttle.load = null;
      shuttle.vehicle.loaded = false;
      return load;
    }, [shuttle.object.id]);
    f.vehicle.then(() => {
      this.setShuttle(shuttle, "returning", "지게차가 빈 팔레트 회수");
      this.goHome(shuttle, null);
    });
    const top = source.top.position.clone().setY(source.top.position.y + STREAM_CONFIG.palletHeight);
    this.place(f, top, source.dock.yaw, half, (load) => {
      this.attachTo(this.host.root, load.group);
      load.group.position.copy(top);
      load.group.rotation.set(0, source.dock.yaw, 0);
      this.stats.emptyStacked++;
      if (shuttle.feed) shuttle.feed.emptyReturned++;
      if (source.stack.length + 2 > this.stackMax(source)) {
        // Stack full: the stacked pallet is taken away (infinite store), the stack keeps its height.
        this.host.unrender(load.group);
        load.group.removeFromParent();
        return;
      }
      source.stack.push(source.top);
      source.top = load.group;
    }, []);
    f.vehicle.then(() => { if (source.busy === f) source.busy = null; });
    this.finish(f);
  }
  /**
   * Carrier forklift: while its pallet is not full it holds it at the loading robot; when full it carries it (forks up) to its
   * unload dock, lowers it there and waits for the depalletizing robot, then brings the empty pallet back to the station.
   */
  private carrierJob(f: Forklift<C>) {
    const c = f.carrier;
    if (!c) return;
    const { pallet, dock } = c;
    if (!pallet.full || !dock) {
      this.setForklift(f, "holdLoading");
      return;
    }
    if (this.host.unloadBusy(dock.id) || this.busyDocks.has(dock.id)) {
      this.setForklift(f, "waitTarget");
      return;
    }
    this.busyDocks.add(dock.id);
    f.job = "carry";
    const v = f.vehicle, t = this.now();
    const record = this.host.cargo.currentPallet(pallet.object.id)?.id;
    this.host.cargo.completePallet({ t, stationId: pallet.object.id });
    if (record) this.host.cargo.dispatchPallet({ t, palletId: record, amrId: f.object.id, destinationId: dock.id });
    pallet.shipping = true;
    const boxes = this.host.takePlaced(pallet.object.id).sort((a, b) => b.node.getWorldPosition(new Vector3()).y - a.node.getWorldPosition(new Vector3()).y);
    const group = pallet.group;
    f.carrying = { group, boxes, palletId: record };
    this.stats.carrierTrips++;
    this.setForklift(f, "toDock");
    const half = STREAM_CONFIG.palletDepth / 2;
    const station = new Vector3(pallet.object.x, 0, pallet.object.z);
    const stationStand = forkliftStop(station, c.heading, half + FORK_BACK);
    const at = new Vector3(dock.x, 0, dock.z);
    // Along the dock axis, from the end nearer the station.
    const heading = [dock.yaw, dock.yaw + Math.PI]
      .map((h) => ({ h, d: forkliftStop(at, h, half + FORK_BACK).distanceTo(stationStand) }))
      .sort((a, b) => a.d - b.d)[0].h;
    const stand = forkliftStop(at, heading, half + FORK_BACK), inPose = forkliftStop(at, heading, 0);
    const carry = Math.max(FORKLIFT_CONFIG.carryLift, forkLiftFor(pallet.baseY) + FORKLIFT_CONFIG.carryLift);
    let emptied = false;
    v.forkTo(carry)
      .straight(stationStand, { backward: true })
      .goTo(stand, true).turn(heading)
      .straight(inPose)
      .forkTo(forkLiftFor(0))
      .then(() => {
        if (record) this.host.cargo.arrivePallet({ t: this.now(), palletId: record, dockId: dock.id });
        this.setForklift(f, "holdUnloading");
        this.host.unload(dock, group, boxes, record, true, () => {
          emptied = true;
        });
      })
      .until(() => emptied)
      .then(() => {
        f.carrying = null;
        this.setForklift(f, "toStation");
      })
      .forkTo(carry)
      .straight(stand, { backward: true })
      .then(() => this.busyDocks.delete(dock.id))
      .goTo(stationStand, true).turn(c.heading)
      .straight(f.home)
      .forkTo(forkLiftFor(pallet.baseY))
      .then(() => {
        // Exact station pose: the loading robot's slot points are fixed in the world.
        v.carrier.position.copy(f.home);
        v.carrier.rotation.y = c.heading;
        pallet.mount(group);
        const settings = this.host.settings()[pallet.object.id];
        this.host.cargo.startPallet({ t: this.now(), stationId: pallet.object.id, grade: settings?.grade ?? "normal" });
        this.setForklift(f, "holdLoading");
      });
    this.finish(f);
  }
  /** Rack forklift: Rack_m (at the drop point) → Rack, or Rack → outbound stage dock (alternating when both wait). */
  private rackJob(f: Forklift<C>) {
    const cell = this.cellOf(f.object.id), own = (rack: SceneEquipment) => this.cellOf(rack.id) === cell;
    const rackM = this.racks.find((r) => r.state === "unloading" && own(r.object) && r.levels.some((l, i) => l && !r.booked.has(i)));
    const slot = rackM ? this.host.rackFree(this.slotBookings, own) : null;
    const canStore = !!rackM && !!slot;
    const stage = this.stages.find((s) => own(s) && !this.busyDocks.has(s.id) && !this.host.unloadBusy(s.id));
    const oldest = stage ? this.host.rackOldest(this.shipClaims, own) : null;
    const canShip = !!oldest && this.stored.has(`${oldest.rack.id}:${oldest.slot}`);
    if (!canStore && !canShip) return;
    const ship = canShip && (!canStore || f.lastJob === "store");
    if (ship) this.shipJob(f, oldest!.rack, oldest!.slot, stage!);
    else this.storeJob(f, rackM!, slot!.rack, slot!.slot);
  }
  private storeJob(f: Forklift<C>, rackM: RackM<C>, rack: SceneEquipment, slot: number) {
    // Top level first.
    let level = -1;
    for (let i = rackM.levels.length - 1; i >= 0; i--) if (rackM.levels[i] && !rackM.booked.has(i)) { level = i; break; }
    rackM.booked.add(level);
    const key = `${rack.id}:${slot}`;
    this.slotBookings.add(key);
    f.job = "store";
    this.setForklift(f, "toPick");
    const p = rackM.group.position;
    const point = new Vector3(p.x, RACK_M_MODEL.levels[level], p.z);
    const heading = rackHeading({ x: p.x, z: p.z, yaw: rackM.group.rotation.y });
    this.pick(f, point, heading, RACK_M_MODEL.width / 2, () => rackM.levels[level], rackM.agv ? [rackM.agv.object.id] : []);
    f.vehicle.then(() => {
      rackM.levels[level] = null;
      rackM.booked.delete(level);
    });
    const slotPoint = rackSlotPoint(rack, slot);
    const { x } = RACK_CONFIG.slots[slot];
    this.place(f, slotPoint, rackHeading(rack), RACK_CONFIG.front - x + STREAM_CONFIG.palletDepth / 2, (load) => {
      this.slotBookings.delete(key);
      this.stored.set(key, load);
      this.host.rackStore(rack, slot, load.group, load.boxes.map((b) => b.node), load.palletId);
      this.stats.storedToRack++;
    }, [], undefined, RACK_CONFIG.liftClearance + 0.02);
    this.returnIfIdle(f);
    this.finish(f);
  }
  private shipJob(f: Forklift<C>, rack: SceneEquipment, slot: number, stage: SceneEquipment) {
    const key = `${rack.id}:${slot}`;
    this.shipClaims.add(key);
    this.busyDocks.add(stage.id);
    f.job = "ship";
    this.setForklift(f, "toPick");
    const { x } = RACK_CONFIG.slots[slot];
    this.pick(f, rackSlotPoint(rack, slot), rackHeading(rack), RACK_CONFIG.front - x + STREAM_CONFIG.palletDepth / 2, () => {
      const load = this.stored.get(key);
      const group = this.host.rackTake(rack, slot);
      this.stored.delete(key);
      this.shipClaims.delete(key);
      return load && group ? { ...load, group } : null;
    }, [], RACK_CONFIG.liftClearance + 0.02);
    const point = new Vector3(stage.x, 0, stage.z);
    this.place(f, point, stage.yaw, STREAM_CONFIG.palletDepth / 2, (load) => {
      this.attachTo(this.host.root, load.group);
      load.group.position.set(stage.x, 0, stage.z);
      load.group.rotation.set(0, stage.yaw, 0);
      if (load.palletId) this.host.cargo.arrivePallet({ t: this.now(), palletId: load.palletId, dockId: stage.id });
      const sorted = [...load.boxes].sort((a, b) => b.node.getWorldPosition(new Vector3()).y - a.node.getWorldPosition(new Vector3()).y);
      this.host.unload(stage, load.group, sorted, load.palletId, false, () => {
        this.stats.shippedPallets++;
        if (load.palletId) this.host.cargo.shipPallet({ t: this.now(), palletId: load.palletId, dockId: stage.id });
      });
    }, [], () => {
      this.busyDocks.delete(stage.id);
    });
    this.returnIfIdle(f);
    this.finish(f);
  }
  /** Goes home only when no further rack work is waiting (saves trips across the aisle). */
  private returnIfIdle(f: Forklift<C>) {
    f.vehicle.then(() => {
      const cell = this.cellOf(f.object.id), own = (rack: SceneEquipment) => this.cellOf(rack.id) === cell;
      const more = this.racks.some((r) => r.state === "unloading" && own(r.object) && r.levels.some((l) => l)) || this.host.rackOldest(this.shipClaims, own);
      if (!more) this.returnHome(f);
    });
  }

  // ---------------------------------------------------------------- display
  get snapshot(): CycleSnapshotItem[] {
    return [
      ...this.shuttles.map((s) => ({
        id: s.object.id, kind: "shuttle" as const, state: s.state, label: SHUTTLE_STATES[s.state],
        detail: `${s.mode === "scan" ? "스캔 하역" : "지게차 교체"}${s.feed ? ` · 팔레트 입하 ${s.feed.fed} · 빈 팔레트 ${s.emptyByForklift ? "지게차 회수" : "반송"} ${s.feed.emptyReturned}` : ""} · 적재 ${s.pallet.count}/${s.pallet.slots.length} · 운행 ${s.trips}`,
      })),
      ...this.forklifts.map((f) => ({
        id: f.object.id, kind: "forklift" as const, state: f.state, label: FORKLIFT_TASK_STATES[f.state],
        detail: `${f.task === "service" ? "AMR 교체 지게차" : f.task === "carrier" ? `운반 지게차 · 적재 ${f.carrier?.pallet.count ?? 0}/${f.carrier?.pallet.slots.length ?? 0}` : "랙 지게차"}${f.job ? ` · ${FORKLIFT_JOBS[f.job]}` : ""} · 완료 ${f.done}`,
      })),
      ...this.agvs.map((a) => ({ id: a.object.id, kind: "agv" as const, state: a.state, label: AGV_STATES[a.state], detail: `운반 ${a.trips}` })),
      ...this.racks.map((r) => ({
        id: r.object.id, kind: "rackm" as const, state: r.state, label: RACK_M_STATES[r.state],
        detail: `팔레트 ${r.levels.filter((l) => l).length}/${r.levels.length} · 만재 ${r.fills}`,
      })),
    ];
  }
  /** Agent-like snapshot rows (details panel / Hud) for the cycle vehicles. */
  agentRows(): { id: string; name: string; state: "idle" | "pickup" | "loading" | "dispatch" | "unloading" | "returning" | "waiting"; status: string; target: string | null; completed: number; battery: number }[] {
    type Row = "idle" | "pickup" | "loading" | "dispatch" | "unloading" | "returning" | "waiting";
    const shuttleState = (s: ShuttleState): Row =>
      s === "loading" ? "loading" : s === "toUnload" || s === "toService" ? "dispatch" : s === "unloading" || s === "swapping" ? "unloading" : s === "waitSwap" || s === "waitDock" || s === "waitEmpty" ? "waiting" : "returning";
    const agvState = (s: AgvState): Row =>
      s === "idle" ? "idle" : s === "toRack" ? "pickup" : s === "lifting" ? "loading" : s === "toDrop" || s === "toBay" ? "dispatch" : s === "lowering" ? "unloading" : s === "waitEmpty" ? "waiting" : "returning";
    const forkState = (s: ForkliftTaskState): Row =>
      s === "idle" ? "idle" : s === "waitTarget" ? "waiting" : s === "returning" || s === "toStation" ? "returning" : s === "carry" || s === "toDock" ? "dispatch"
        : s === "putDown" || s === "holdUnloading" ? "unloading" : s === "holdLoading" ? "loading" : "pickup";
    return [
      ...this.shuttles.map((s) => ({ id: s.object.id, name: s.object.name, state: shuttleState(s.state), status: `[${SHUTTLE_STATES[s.state]}] 적재 ${s.pallet.count}/${s.pallet.slots.length}`, target: s.dock.name, completed: s.trips, battery: 100 })),
      ...this.agvs.map((a) => ({ id: a.object.id, name: a.object.name, state: agvState(a.state), status: `[${AGV_STATES[a.state]}]`, target: this.racks.find((r) => r.agv === a)?.object.name ?? null, completed: a.trips, battery: 100 })),
      ...this.forklifts.map((f) => ({ id: f.object.id, name: f.object.name, state: forkState(f.state), status: `[${FORKLIFT_TASK_STATES[f.state]}]${f.job ? ` ${FORKLIFT_JOBS[f.job]}` : ""}`, target: null, completed: f.done, battery: 100 })),
    ];
  }
}
