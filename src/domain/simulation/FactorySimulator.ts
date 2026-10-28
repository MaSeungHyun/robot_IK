import { ScannerInspection } from "@/domain/scanner/ScannerInspection";
import { KpiCollector, type KpiSample } from "@/domain/kpi/KpiCollector";
import { CONVEYOR_LAYOUT } from "@/constants/conveyorLayoutConfig";
import { SCANNER_CONFIG } from "@/constants/scanner";
import { Euler, Group, Vector3 } from "three";
import type {
  SceneEquipment,
  EquipmentSettings,
  FactoryLayout,
  CargoGrade,
} from "@/types/layout";
import type { Transfer } from "@/types/robot";
import type { StreamStats } from "@/types/conveyor";
import type { EquipmentSnapshot } from "@/types/simulation";
import { BOX_SIZES, STREAM_CONFIG, ROBOT_PICKING, PALLET_STACKING, CONVEYOR_STOPPER_CONTACT } from "@/constants/simulation";
import { DEFAULT_LAYOUT, AMR_TRAFFIC, AMR_BATTERY, SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { createUnitBox } from "@/lib/three/modelNormalization";
import { amrSpeedFactor, autoSpawns, beltSpeedOf, spawnIntervalOf } from "@/domain/simulation/equipmentSpeeds";
import { RACK_CONFIG, rackApproachPoint, rackFacePoint, rackHeading, rackSlotPoint, rackStandoff } from "@/constants/rack";
import { LinkIndex, type SceneLink } from "@/types/links";
import { TransportQueue } from "@/domain/amr/TransportQueue";
import { PalletController } from "@/domain/pallet/PalletController";
import { PalletDispatchController } from "@/domain/amr/PalletDispatchController";
import { AMRTrafficController, type TrafficBody, type TrafficPlanner } from "@/domain/amr/AMRTrafficController";
import type { DispatchRoutes } from "@/domain/amr/PalletDispatchController";
import { layoutPath, routeFailureReason } from "@/domain/amr/navigation/layoutNavigation";
import { robotArmState, vehicleState } from "@/domain/state/equipmentState";
import { deckFeedIntervalOf, doesGeneralJobs, selfUnloadOf, stackCapacityOf, takesEmptyPallets } from "@/constants/emptyPallet";
import { CYCLE_CONFIG } from "@/constants/cycle";
import type { NavigationObstacle } from "@/domain/amr/navigation/layoutNavigation";
import {
  beltConnections,
  connectedBeltIds,
  beltLength,
  beltPoint,
} from "@/domain/conveyor/conveyorLayout";
import type { SimulationRenderer } from "@/domain/simulation/SimulationRenderer";
import { CargoRegistry } from "@/domain/cargo/CargoRegistry";
import { log } from "@/stores/useLogStore";
import { ForkliftController, type ForkliftJob, type ForkliftTarget } from "@/domain/amr/ForkliftController";
import { isForkliftRole } from "@/types/layout";
import { FORKLIFT_CONFIG, FORKLIFT_TRAFFIC, forkliftStop } from "@/constants/forklift";
import { AMR_COOPERATION } from "@/constants/amr";

const ROUTE_CACHE_SIZE = 256;
import { DOOR_CONFIG } from "@/constants/door";
import { wallSegments } from "@/domain/room/roomWalls";
import { PALLET_CONVEYOR } from "@/constants/palletConveyor";
import { PalletCycle, type PalletCycleHost } from "@/domain/cycle/PalletCycle";
import { AMR_DECK, ROLLER_DECK } from "@/constants/cycle";
import { isPalletInbound, palletFeeds, receivePose } from "@/domain/cycle/palletFeed";
import { createPalletModel } from "@/lib/three/palletModel";
import { planStack } from "@/domain/pallet/packing/stacking";
import { scannerBeltId, scannerEntry, scannerExit, withScannerBelts } from "@/domain/conveyor/scannerBelt";
import { ROBOT_STOP_PREFIX, withRobotStops } from "@/domain/layout/robotStops";
import { remapStopLinks, withStopPoints } from "@/domain/layout/stopPoints";
import { isDepalletizer } from "@/domain/robot/robotRole";

/** Small seeded PRNG (mulberry32), uniform in [0, 1). */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** FNV-1a hash of the scene layout (ids, kinds, poses): the forklift PRNG seed. */
function sceneSeed(objects: readonly SceneEquipment[]) {
  let hash = 0x811c9dc5;
  for (const o of objects)
    for (const ch of `${o.id}|${o.kind}|${o.x.toFixed(3)}|${o.z.toFixed(3)}|${o.yaw.toFixed(3)};`)
      hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193);
  return hash >>> 0;
}

export type Cargo = {
  /** Registry id (B-0001...). */
  id: string;
  node: Group;
  belt: SceneEquipment;
  distance: number;
  state: "moving" | "reserved" | "held" | "placed" | "departing" | "passed";
  job?: Transfer;
  pallet?: string;
  attempted: Set<string>;
  /** Actual belt travel speed this step (m/s); 0 while queued at an end stopper. */
  speed?: number;
};
export type FactoryRobot = {
  object: SceneEquipment;
  jobs: Transfer[];
  busy: boolean;
  completed: number;
  status: string;
  count: number;
  busySeconds: number;
  /** Why an idle robot takes nothing (e.g. the box is out of the arm's feasible reach). */
  warning?: string;
};
const PALLET_FEED_GAP = 0.3;
/** AMRs booked onto one unload dock at a time: the next one is sent only after the previous has unloaded and driven clear. */
/** Per unload dock: the AMR unloading there plus one loaded AMR waiting at the staging distance. */
const FEED_DOCK_BOOKINGS = 2;
/** Route-length penalty (m) per AMR already booked on a feed dock: larger than any route, so free docks go first. */
/** Steps a failed route search is remembered (same start/goal), ~2 s of sim time. */
/** ~0.5 s (was 2 s): a failure is also dropped as soon as the moving obstacles change (signature below). */
const ROUTE_FAIL_HOLD_STEPS = 30;
const FEED_DOCK_BUSY_COST = 1e5;
/** Margin (m) beyond two AMR footprints the previous AMR must clear a station by before the next one heads there. */
const FEED_CLEAR_MARGIN = 0.6;
type HeldPallet = { group: Group; boxes: Cargo[]; distance: number; agent: FactoryAgent | null };
/** Pallet-inbound belt: loaded pallets spawn on its interval, queue nose-to-tail and stop at the end stopper. */
type PalletHold = {
  belt: SceneEquipment; timer: number; pallets: HeldPallet[]; warned: string | null; routeRetryAt?: number;
  /** AMR that just took the lead pallet; the queued AMR enters the receive pose once it has cleared it. */
  leaving: FactoryAgent | null;
  fed?: number; arrivals: number[];
};
export type FactoryAgent = {
  object: SceneEquipment;
  dispatch: PalletDispatchController;
  completed: number;
  waiting: boolean;
  waitingReason: string | null;
  target: string | null;
  /** Simulated battery level, 0-100 %. */
  battery: number;
  charging: boolean;
};
/** Forklift (amrRole "forklift"; legacy "rack" is read as forklift); see ForkliftController. */
export type FactoryForkliftAgent = {
  object: SceneEquipment;
  controller: ForkliftController;
  /** Why the last assignment attempt failed (shown while idle). */
  waitingReason: string | null;
};
/** Pallet an AMR left on an unload dock; a depalletizing robot takes its boxes (top first) onto a belt. */
/** `keep`: the emptied pallet stays (pallet cycle shuttle), `onEmpty` runs once it is empty. */
type AgentRow = EquipmentSnapshot["agents"][number];
const pathLength = (points: Vector3[]) => points.reduce((sum, p, i) => (i ? sum + p.distanceTo(points[i - 1]) : 0), 0);
/** Shortest distance (xz) from `p` to a polyline. */
function polylineDistance(p: Vector3, line: Vector3[]) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return line.length === 1 ? Math.hypot(p.x - line[0].x, p.z - line[0].z) : best;
}
/** deck: AMR self-unload (no scan-start robot): the AMR's own roller deck feeds this belt start; robots skip it. */
type UnloadLoad = { dock: SceneEquipment; group: Group; boxes: Cargo[]; palletId?: string; top: number; keep?: boolean; onEmpty?: () => void; scan?: boolean; deck?: SceneEquipment };
/** AMR self-unload: seconds of sim time between boxes rolled off the deck onto the belt start (fixed: speed-independent). */
const EMPTY_PICK_WAIT = "지게차 대기 · 빈 팔레트를 내려줄 지게차가 없습니다.";
const EMPTY_PICK_NO_FORKLIFT = "빈 팔레트 회수 지게차 없음 · AMR이 빈 팔레트를 실은 채 대기";
/** Id prefix of a forklift's floor empty-pallet stack (no palletSource dock in the layout). */
const FLOOR_STACK = "emptyfloor:";
const EMPTY_PICK_NO_STACK = "빈 팔레트 적치장 없음 · AMR이 빈 팔레트를 실은 채 대기";
/** AMR self-unload: stop pose distance (m) back from the belt start. */
const DECK_FEED_GAP = 1.2;
/** Pallet handed from an AMR's top roller onto an outbound (출하) belt; `distance` < 0 = still rolling off the AMR. */
type RollingPallet = { belt: SceneEquipment; group: Group; boxes: Group[]; distance: number; fromY: number; palletId?: string };
const FORKLIFT_HANDOFF_GAP = 6.5;
/** `points` shortened by `gap` metres from its end (at least the start remains). */
function trimPath(points: Vector3[], gap: number) {
  let left = gap;
  for (let i = points.length - 1; i > 0; i--) {
    const seg = points[i].distanceTo(points[i - 1]);
    if (seg > left) return [...points.slice(0, i).map((p) => p.clone()), points[i].clone().lerp(points[i - 1], left / seg)];
    left -= seg;
  }
  return [points[0].clone(), points[0].clone()];
}
/** AMR traffic replans run in axis mode (grid-aligned legs, no any-angle diagonals). */
const AXIS_ROUTE = { axis: true } as const;
/** Nearest world axis (multiple of 90°): forklifts place pallets along world axes, so the AMR receives square to them. */
const axisHeading = (yaw: number) => (Math.PI / 2) * Math.round(yaw / (Math.PI / 2));
const pathHeading = (points: Vector3[]) => {
  const a = points[Math.max(0, points.length - 2)], b = points[points.length - 1];
  return a.distanceTo(b) > 1e-3 ? Math.atan2(b.x - a.x, b.z - a.z) : 0;
};
const FORKLIFT_MISSING = "지게차 없음 · 바닥 팔레트 이동 불가";
const NO_FLOW = "공정 흐름을 생성할 수 없음 · 로봇과 AMR이 없어 팔레트를 처리할 수 없습니다";
const isOutbound = (o: SceneEquipment, settings: Record<string, EquipmentSettings>) =>
  o.kind === "conveyor" && settings[o.id]?.conveyorRole === "outbound";
/** A pallet stored in a rack slot: its group and the box nodes registered for rendering. */
type StoredPallet = { group: Group; boxes: Group[] };
/** Seconds between rack-unload assignment checks (sim time). */
const RACK_UNLOAD_RETRY_S = 1;
/** A forklift held by traffic this long (s) switches target side / rack or backs off and replans. */
const FORKLIFT_STUCK_S = 6;
/** Extra distance (m) of the floor hand-off point beyond the regular rack approach point. */
const HANDOFF_EXTRA = 0.6;
/** Level-1 centre slot: hand-off pallets are left in front of it. */
const HANDOFF_SLOT = (() => {
  const low = Math.min(...RACK_CONFIG.slots.map((s) => s.y));
  const index = RACK_CONFIG.slots.findIndex((s) => s.column === "C" && s.y === low);
  return index >= 0 ? index : 0;
})();
/** Pallet an AMR left on a rack's floor hand-off point, waiting for a forklift to store it. */
type Handoff = {
  rack: SceneEquipment;
  /** Booked slot (key in slotBookings); a forklift may move the booking to another slot / rack. */
  slot: number;
  group: Group;
  boxes: Group[];
  palletId?: string;
  claimed: boolean;
};
/** Distance of the inside / outside door waypoints from the door plane (m). */
const DOOR_INSIDE = 1.6;
const DOOR_OUTSIDE = 2;
/** Half the room wall thickness used as its navigation clearance (RoomWall frame is <= 0.12 m). */
const WALL_HALF_THICKNESS = 0.12;
type Shipment = {
  pallet: PalletController;
  group: Group;
  cargo: Set<Cargo>;
  agent: FactoryAgent;
  replaced: boolean;
  /** Destination dock; booked from dispatch until the dropped pallet is cleared. */
  dock: SceneEquipment;
  /** Set once the pallet has been lowered onto the dock and released. */
  dropped: boolean;
  /** Rack deliveries: the booked PalletPoint index (`dock` is the rack). */
  slot?: number;
  /** Set once the pallet sits in its rack slot; it stays there. */
  stored?: boolean;
  /** Forklift storage: the AMR leaves the pallet on the rack's floor hand-off point (slot stays booked). */
  handoff?: boolean;
  /** Pallet record (P-001...) travelling with this shipment. */
  palletId?: string;
};
// Deterministic per-id starting charge so AMR cards differ but runs repeat.
const initialBattery = (id: string) => {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return AMR_BATTERY.initialMin + (hash % 1000) / 999 * (AMR_BATTERY.initialMax - AMR_BATTERY.initialMin);
};
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);
/** ship() attempts per dispatch tick, and the delay before a split round continues (sim s). */
const SHIP_ATTEMPTS_PER_TICK = 2;
const SHIP_RESUME_S = 0.15;

/** Placeholder pose far from the scene for unused FactoryLayout entries of forklift routing. */
const FAR_POSE = { x: 1e5, z: 1e5, yaw: 0 };
const palletGrade = (config: EquipmentSettings | undefined): CargoGrade =>
  config?.grade ?? "normal";
/** Warning for a relation without a 🔗 link while 자동 연결 is off. */
const noLink = (relation: string) => `링크 없음 · ${relation} 🔗 링크가 없어 대기합니다 (자동 연결 꺼짐)`;

export class FactorySimulator {
  readonly root = new Group();
  readonly inspection: ScannerInspection;
  /** KPI samples on sim time (see domain/kpi); configure() from the viewport settings. */
  readonly kpi = new KpiCollector();
  /** Per-box / per-pallet records; a new registry per run (cleared on STOP). */
  readonly cargo = new CargoRegistry((message) => log("warning", "박스 추적", message));
  private scanFrom = new Vector3();
  private scanTo = new Vector3();
  readonly robots: FactoryRobot[] = [];
  readonly agents: FactoryAgent[] = [];
  readonly forkliftAgents: FactoryForkliftAgent[] = [];
  /** Forklift pallet choice; seeded from the scene layout so every run (and playback speed) picks the same pallets. */
  private rackRandom: () => number;
  readonly pallets: PalletController[] = [];
  readonly belts: { object: SceneEquipment; elapsed: number }[] = [];
  boxes: Cargo[] = [];
  spawned = 0;
  placed = 0;
  passed = 0;
  dispatched = 0;
  elapsed = 0;
  private boxAsset: Group;
  private settings: () => Record<string, EquipmentSettings>;
  private point = new Vector3();
  private palletOrder = new Map<string, PalletController[]>();
  private dispatchRetry = 0;
  /** (pallet, AMR) pairs already tried in the current dispatch round when it was split over ticks. */
  private dispatchSkip = 0;
  private connections = new Map<string, SceneEquipment>();
  /** Belts ordered downstream-first (chain ends first) for the accumulation queue. */
  private beltOrder: string[] | null = null;
  private queueScratch = new Map<string, Cargo[]>();
  private tailScratch = new Map<string, number>();
  private incoming = new Set<string>();
  private haltedScratch = new Set<string>();
  private instances?: SimulationRenderer;
  private rendered = new Set<Group>();
  private renderingActive = false;
  private traffic = new AMRTrafficController();
  private trafficVehicles: {
    id: string;
    dispatch: PalletDispatchController;
    speed: number;
    enabled: boolean;
  }[] = [];
  private navigation = new Map<
    string,
    { layout: FactoryLayout; obstacles: NavigationObstacle[] }
  >();
  private shipments: Shipment[] = [];
  /** Equipment relations (🔗); equipment without links of a type uses the distance fallback. */
  private links: LinkIndex;
  /** Belts a robot picks from (linked conveyors and their connected sections); absent = any belt in reach. */
  private feedBelts = new Map<string, Set<string>>();
  /** Global "자동 연결": relations without a 🔗 link use the nearest/automatic choice (false: they do nothing and warn). */
  private readonly auto: boolean;
  readonly transport = new TransportQueue();
  /** Stations whose current full pallet was already reported (palletFull log); cleared on replacement. */
  private fullReported = new Set<PalletController>();
  /** Per-step scratch (advance runs every fixed step; avoid allocations). */
  private readonly reachableScratch = new Set<CargoGrade>();
  private readonly pickBoxes: Cargo[] = [];
  private readonly pickGrades: CargoGrade[] = [];
  private readonly nearBoxes: Cargo[] = [];
  private readonly nearGrades: CargoGrade[] = [];
  private readonly shipmentScratch: Shipment[] = [];
  constructor(
    objects: SceneEquipment[],
    box: Group,
    pallet: Group,
    getSettings: () => Record<string, EquipmentSettings>,
    instances?: SimulationRenderer,
    random?: () => number,
    links: readonly SceneLink[] = [],
    autoConnect = true,
  ) {
    this.auto = autoConnect;
    // Free-standing ScanTunnel scanners run boxes on their own belt (sim-only conveyor; see scannerBelt.ts).
    ({ objects, getSettings } = withScannerBelts(objects, getSettings));
    // Floor-click stop points (하역/교체/출고/출하 대기/Rack_m 하차) of robots, forklifts and AMRs become sim docks.
    ({ objects, getSettings } = withStopPoints(objects, getSettings, links));
    // No unload dock needed: AMRs stop at a reachable free pose next to the depalletizing robot itself.
    ({ objects, getSettings } = withRobotStops(objects, getSettings));
    this.layoutObjects = objects;
    this.links = new LinkIndex(remapStopLinks(links, objects));
    this.rackRandom = mulberry32(sceneSeed(objects));
    // Seeded from the layout and timed by the sim clock: identical scan results/signals at every speed and run.
    this.inspection = new ScannerInspection(getSettings, random ?? mulberry32(sceneSeed(objects) ^ 0x5ca11e7), () => this.elapsed);
    this.instances = instances;
    this.settings = getSettings;
    this.boxAsset = createUnitBox(box);
    const owned = PalletCycle.owned(objects, this.settings());
    // Roller-top shuttles fed by a pallet-unit inbound belt carry their pallet at the belt height.
    const rollerShuttles = owned ? palletFeeds(objects, this.settings(), (id) => this.links.outgoing(id, "feed")) : new Map<string, SceneEquipment>();
    for (const object of objects) {
      if (owned?.has(object.id)) continue;
      if (object.kind === "robot") {
        const unloading = isDepalletizer(this.settings()[object.id]);
        const robot: FactoryRobot = {
          object,
          jobs: [],
          busy: false,
          completed: 0,
          status: unloading ? "하역 팔레트 대기" : "범위 내 박스 대기",
          count: 0,
          busySeconds: 0,
        };
        this.robots.push(robot);
        if (unloading) this.depalletizers.push(robot);
      }
      if (object.kind === "conveyor" && isOutbound(object, this.settings())) this.outboundBelts.push(object);
      else if (object.kind === "conveyor") this.belts.push({ object, elapsed: 0 });
      if (object.kind === "pallet") {
        // A pallet mounted on a pallet-cycle shuttle AMR sits on its deck (the cycle parents it to the carrier).
        const mountedOn = this.settings()[object.id].mountedOn,
          shuttle = mountedOn && owned?.has(mountedOn) ? objects.find((o) => o.id === mountedOn) : undefined;
        const state = shuttle
          ? new PalletController({ ...object, x: shuttle.x, z: shuttle.z }, pallet, this.settings()[object.id].capacity, rollerShuttles.has(shuttle.id) ? ROLLER_DECK : AMR_DECK)
          : new PalletController(object, pallet, this.settings()[object.id].capacity);
        this.pallets.push(state);
        this.root.add(state.group);
        this.render(state.group);
      }
      if (object.kind === "amr" && isForkliftRole(this.settings()[object.id]?.amrRole))
        this.forkliftAgents.push({
          object,
          controller: new ForkliftController(object, (from, to, loaded) => this.forkliftRoute(from, to, loaded)),
          waitingReason: null,
        });
      else if (object.kind === "amr")
        this.agents.push({
          object,
          dispatch: new PalletDispatchController({
            ...DEFAULT_LAYOUT,
            amr: object,
          }),
          completed: 0,
          waiting: false,
          waitingReason: null,
          target: null,
          battery: initialBattery(object.id),
          charging: false,
        });
    }
    // AMR meshes render through the instanced scene; tagging the carrier lets viewport hits resolve to the AMR.
    for (const agent of this.agents) agent.dispatch.carrier.userData.sceneId = agent.object.id;
    for (const agent of this.forkliftAgents) agent.controller.carrier.userData.sceneId = agent.object.id;
    this.doors = objects.filter((o) => o.kind === "door");
    // Room walls (split at door openings) block AMR and forklift routes; the planner's body radius covers a carried pallet.
    this.wallObstacles = wallSegments(objects, this.settings()).map(({ a, b }) => ({
      kind: "floor" as const,
      pose: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: 0 },
      radius: WALL_HALF_THICKNESS,
      path: [new Vector3(a.x, 0, a.z), new Vector3(b.x, 0, b.z)],
    }));
    for (const door of this.doors) this.doorFraction.set(door.id, 0);
    this.trafficVehicles = this.agents.map((agent) => ({
      id: agent.object.id,
      dispatch: agent.dispatch,
      speed: 1,
      enabled: true,
    }));
    // Outbound pallet belts never join a box line.
    const connections = beltConnections(objects.filter((o) => !isOutbound(o, this.settings())));
    this.connections = connections.next;
    this.incoming = connections.incoming;
    // Belts start empty; boxes only come from regular inlet spawning in advance().
    const dockRole = (o: SceneEquipment) => this.settings()[o.id]?.dockRole;
    this.docks = objects.filter((o) => o.kind === "dock" && (!dockRole(o) || dockRole(o) === "ship"));
    this.unloadDocks = objects.filter((o) => o.kind === "dock" && (dockRole(o) === "unload" || dockRole(o) === "stage"));
    this.racks = objects.filter((o) => o.kind === "rack" && !owned?.has(o.id));
    for (const rack of this.racks)
      this.rackStored.set(rack.id, RACK_CONFIG.slots.map(() => false));
    for (const rack of this.racks) this.rackPallets.set(rack.id, RACK_CONFIG.slots.map(() => undefined));
    for (const rack of this.racks) this.rackGroups.set(rack.id, RACK_CONFIG.slots.map(() => undefined));
    this.rackLayout = {
      robot: this.robots[0]?.object ?? FAR_POSE,
      conveyor: this.belts[0]?.object ?? FAR_POSE,
      pallet: FAR_POSE,
      amr: FAR_POSE,
      dock: FAR_POSE,
    };
    this.rackObstacles = [
      ...this.wallObstacles,
      ...this.robots.map((r) => ({ kind: r.object.kind, pose: r.object })),
      ...this.belts.map((b) => ({ kind: b.object.kind, pose: b.object })),
      ...this.outboundBelts.map((b) => ({ kind: b.kind, pose: b })),
      ...this.pallets.filter((p) => !p.baseY).map((p) => ({ kind: p.object.kind, pose: p.object })),
      ...this.racks.map((r) => ({ kind: r.kind, pose: r })),
    ];
    for (const robot of this.robots) {
      const fed = this.links.incoming(robot.object.id, "feed");
      if (fed.length) {
        const belts = new Set<string>();
        for (const id of fed) for (const belt of connectedBeltIds(objects, id)) belts.add(belt);
        this.feedBelts.set(robot.object.id, belts);
      } else if (!this.auto && !this.depalletizers.includes(robot)) {
        this.feedBelts.set(robot.object.id, new Set());
        this.warnOnce(noLink("공급(컨베이어 → 로봇)"), robot.object.name);
      }
    }
    for (const robot of this.robots)
      this.palletOrder.set(
        robot.object.id,
        this.linkedOrAll(this.pallets, this.links.outgoing(robot.object.id, "load"), (p) => p.object.id).sort(
          (a, b) =>
            distance(robot.object, a.object) - distance(robot.object, b.object),
        ),
      );
    // Far-first fill order per layer relative to the robots that load each pallet (linked loaders, else the nearest robot).
    for (const pallet of this.pallets) {
      const linked = this.links.incoming(pallet.object.id, "load");
      let loaders = this.robots.filter((robot) => linked.includes(robot.object.id));
      if (!loaders.length && this.auto) {
        const nearest = this.robots.reduce<FactoryRobot | null>((best, next) =>
          !best || distance(next.object, pallet.object) < distance(best.object, pallet.object) ? next : best, null);
        loaders = nearest ? [nearest] : [];
      }
      pallet.orderFrom(loaders.map((robot) => ({ x: robot.object.x, z: robot.object.z, reach: this.settings()[robot.object.id]?.reach ?? Infinity })));
    }
    this.scanners = objects.filter((o) => o.kind === "scanner");
    // Scan gate: only boxes without an inspection result are inspected (one result per box, never re-scanned).
    this.inspection.isInspected = (node) => node.userData.inspected === true || (this.cargo.box(node.userData.boxId)?.inspection ?? null) !== null;
    this.inspection.onScan = (node, scannerId, result) => {
      const id = node.userData.boxId;
      if (id) this.scannedIds.add(id);
      // Inbound-pallet box checked by a scanner: it now flows like any other box.
      if (id && this.feedBoxIds.delete(id)) this.feedScan.passed++;
      if (node.userData.boxId)
        this.cargo.scanBox({ t: this.elapsed, boxId: node.userData.boxId, scannerId, result: result === "fault" ? "defect" : "normal" });
    };
    for (const pallet of this.pallets) this.startPalletRecord(pallet);
    this.cycle = owned
      ? new PalletCycle(objects, this.pallets, this.cycleHost(pallet), (id) => this.links.outgoing(id, "deliver"), (id) => this.links.outgoing(id, "feed"))
      : null;
    // Pallet-inbound belts not served by a pallet-cycle shuttle: a full pallet runs to the belt-end stopper and an AMR is
    // dispatched to the receive pose (🔗-linked AMR first, else the nearest free empty pallet AMR); re-evaluated every tick.
    for (const belt of objects) {
      if (belt.kind !== "conveyor" || !isPalletInbound(this.settings(), belt.id) || this.cycle?.feedBelts.has(belt.id)) continue;
      this.palletHolds.push({ belt, timer: spawnIntervalOf(this.settings()[belt.id] ?? {}), pallets: [], warned: null, leaving: null, arrivals: [] });
    }
    this.palletAsset = pallet;
    for (const rack of this.racks) this.seedRackContents(rack);
    // Without the pallet cycle the simulator keeps the empty-pallet stacks itself (the cycle owns them otherwise).
    if (!this.cycle)
      for (const dock of objects)
        if (dock.kind === "dock" && this.settings()[dock.id]?.dockRole === "palletSource") this.emptyStacks.push({ dock, pallets: [] });
  }
  /** Equipment of the run (incl. sim-only scanner belts / robot stops): a floor empty stack keeps clear of it. */
  private layoutObjects: SceneEquipment[] = [];
  /** Simulator-owned empty pallet stacks (palletSource docks, only without the pallet cycle; plus forklift floor stacks). */
  private readonly emptyStacks: { dock: SceneEquipment; pallets: Group[] }[] = [];
  /** Empty pallets put back on a stack (simulator or cycle source), and stacked empties reused for a station. */
  emptyRecycled = 0;
  emptyReused = 0;
  /** Empty pallet back from an unload dock: onto the nearest empty stack (cycle source first), else it leaves the scene. */
  private recycleEmpty(pallet: Group) {
    const at = pallet.getWorldPosition(new Vector3());
    if (this.cycle?.stackEmpty(pallet, at)) {
      this.emptyRecycled++;
      return;
    }
    const gap = (s: { dock: SceneEquipment }) => Math.hypot(s.dock.x - at.x, s.dock.z - at.z);
    const stack = this.emptyStacks.reduce<(typeof this.emptyStacks)[number] | null>((best, s) => (!best || gap(s) < gap(best) ? s : best), null);
    pallet.removeFromParent();
    if (!stack || stack.pallets.length >= stackCapacityOf(this.settings()[stack.dock.id])) {
      this.unrender(pallet);
      return;
    }
    pallet.position.set(stack.dock.x, stack.pallets.length * STREAM_CONFIG.palletHeight, stack.dock.z);
    pallet.rotation.set(0, stack.dock.yaw, 0);
    this.root.add(pallet);
    stack.pallets.push(pallet);
    this.emptyRecycled++;
  }
  /** A station's fresh pallet comes off an empty stack when one has pallets (fixed stack order: deterministic). */
  private reuseEmpty() {
    for (const stack of this.emptyStacks) {
      const top = stack.pallets.pop();
      if (!top) continue;
      top.removeFromParent();
      this.unrender(top);
      this.emptyReused++;
      return;
    }
  }
  private palletAsset: Group;
  private scanners: SceneEquipment[] = [];
  private scannedIds = new Set<string>();
  private feedBoxIds = new Set<string>();
  /** Inbound-pallet boxes: put on a belt by the scan-start robot / put where no scanner follows / left the line unscanned. */
  feedScan = { dropped: 0, bypass: 0, passed: 0, unscanned: 0 };
  /** Self-feed docks (cached: stable ids/objects): belts whose start leads to a scanner, for AMR self-unload. */
  private readonly deckFeedDocks = new Map<string, SceneEquipment>();
  private selfFeedDocks(settings: Record<string, EquipmentSettings>) {
    const out: SceneEquipment[] = [];
    for (const { object: belt } of this.belts) {
      if (!settings[belt.id]?.enabled || !selfUnloadOf(settings[belt.id]) || isPalletInbound(settings, belt.id) || isOutbound(belt, settings)) continue;
      const d = BOX_SIZES[0].z;
      if (!this.scanAfter(belt, d)) continue;
      let dock = this.deckFeedDocks.get(belt.id);
      if (!dock) {
        const p = beltPoint(belt, 0);
        dock = { id: `deckfeed:${belt.id}`, kind: "dock", name: `${belt.name} 자가 투입`, x: p.x - Math.sin(p.yaw) * DECK_FEED_GAP, z: p.z - Math.cos(p.yaw) * DECK_FEED_GAP, yaw: p.yaw };
        this.deckFeedDocks.set(belt.id, dock);
      }
      out.push(dock);
    }
    return out;
  }
  private deckFeedTimers = new Map<UnloadLoad, number>();
  deckFed = 0;
  /** AMR self-unload: roll the deck's boxes one by one onto the belt start (fixed interval, start must be clear). */
  private advanceDeckFeeds(dt: number, settings: Record<string, EquipmentSettings>, halted: Set<string>) {
    for (const load of this.unloadLoads) {
      const belt = load.deck;
      if (!belt || !load.boxes.length || !settings[belt.id]?.enabled || halted.has(belt.id)) continue;
      const t = (this.deckFeedTimers.get(load) ?? 0) + dt;
      const d = BOX_SIZES[0].z;
      const blocked = this.boxes.some((b) => (b.state === "moving" || b.state === "reserved") && b.belt.id === belt.id && Math.abs(b.distance - d) < BOX_SIZES[0].z + 0.1);
      const interval = deckFeedIntervalOf(settings[belt.id]);
      if (t < interval || blocked) {
        this.deckFeedTimers.set(load, Math.min(t, interval));
        continue;
      }
      this.deckFeedTimers.set(load, 0);
      const box = load.boxes.shift()!;
      this.feedScan.dropped++;
      if (!this.scanAfter(belt, d)) this.feedScan.bypass++;
      this.cargo.takeFromPallet({ t: this.elapsed, robotId: load.dock.id, boxId: box.id });
      const point = beltPoint(belt, d);
      this.root.attach(box.node);
      box.node.position.set(point.x, CONVEYOR_LAYOUT.height + BOX_SIZES[0].y, point.z);
      box.node.rotation.set(0, point.yaw, 0);
      box.belt = belt;
      box.distance = d;
      box.state = "moving";
      box.pallet = undefined;
      box.attempted.clear();
      box.job = undefined;
      this.boxes.push(box);
      this.cargo.unloadBox({ t: this.elapsed, robotId: load.dock.id, boxId: box.id, beltId: belt.id });
      this.move(box);
      this.depalletized++;
      this.deckFed++;
    }
    for (const load of this.deckFeedTimers.keys()) if (!this.unloadLoads.includes(load)) this.deckFeedTimers.delete(load);
  }
  /** A box set down at `d` on `belt` reaches a scanner further down its belt chain. */
  private scanAfter(belt: SceneEquipment, d: number) {
    const seen = new Set<string>();
    for (let current: SceneEquipment | undefined = belt, from = d; current && !seen.has(current.id); from = 0) {
      seen.add(current.id);
      const length = beltLength(current);
      for (const scanner of this.scanners)
        for (let x = from; x <= length; x += 0.25) {
          const p = beltPoint(current, x);
          if (Math.hypot(p.x - scanner.x, p.z - scanner.z) < 1) return true;
        }
      const next = this.connections.get(current.id);
      current = next ? this.beltById(next.id) : undefined;
    }
    return false;
  }
  /** Depalletizer that can set boxes on a belt ahead of a scanner (the scan line's start robot). */
  private scanStart(robot: FactoryRobot, settings: Record<string, EquipmentSettings>) {
    const reach = (settings[robot.object.id]?.reach ?? 0) - ROBOT_PICKING.pickReachMargin;
    return this.belts.some(({ object: belt }) => {
      for (let d = BOX_SIZES[0].z; d <= beltLength(belt) - BOX_SIZES[0].z; d += 0.25) {
        const p = beltPoint(belt, d);
        if (Math.hypot(p.x - robot.object.x, p.z - robot.object.z) <= reach && this.scanAfter(belt, d)) return true;
      }
      return false;
    });
  }
  /**
   * Why a pallet AMR cannot feed a scanner: boxes on a pallet need a depalletize robot whose reach covers the scanner
   * belt between its entry (투입구) and the tunnel. Names the 🔗-linked scanner(s) and the nearest robot's distance.
   */
  private missingScanRobot(linkedIds: readonly string[], settings: Record<string, EquipmentSettings>) {
    const linked = this.scanners.filter((sc) => linkedIds.includes(sc.id));
    const targets = linked.length ? linked : this.scanners;
    if (!targets.length) return "스캐너 없음 · 팔레트 AMR이 갈 다음 단계가 없습니다";
    const parts = targets.map((sc) => {
      const entry = scannerEntry(sc), exit = scannerExit(sc);
      const robots = this.robots.filter((r) => isDepalletizer(settings[r.object.id]));
      const near = robots.map((r) => ({ r, d: Math.hypot(r.object.x - entry.x, r.object.z - entry.z), e: Math.hypot(r.object.x - exit.x, r.object.z - exit.z) })).sort((a, b) => a.d - b.d)[0];
      const reach = (near ? settings[near.r.object.id]?.reach ?? 2.5 : 2.5) - ROBOT_PICKING.pickReachMargin;
      const where = !near ? "하역 로봇 없음" : near.e < near.d ? `${near.r.object.name}이(가) 출구 쪽에 있음(입구까지 ${near.d.toFixed(1)} m)` : `가장 가까운 ${near.r.object.name} 입구까지 ${near.d.toFixed(1)} m`;
      return `${sc.name} 입구에 하역 로봇 없음 (${where}) · 하역 로봇을 스캐너 입구~터널 사이 벨트에서 ${reach.toFixed(2)} m 이내에 두세요`;
    });
    return `팔레트 AMR은 로봇이 박스를 내려야 합니다: ${parts.join(" / ")}`;
  }
  /** Pallet-inbound belts outside the pallet cycle: one full pallet at a time, held at the belt-end stopper until an AMR takes it. */
  private palletHolds: PalletHold[] = [];
  /** Unload docks booked by an AMR carrying a fed pallet. */
  private feedDockQueue = new Map<string, FactoryAgent[]>();
  /** AMRs that unloaded a fed pallet and are leaving the dock; the dock stays booked until they clear it. */
  private feedDockLeaving: { dock: SceneEquipment; agent: FactoryAgent }[] = [];
  /** Per unload dock (by name): fed pallets received and seconds spent depalletizing one (utilisation). */
  private trafficTick = 0;
  private readonly failedRoutes = new Map<string, { tick: number; loaded: boolean; sig: string; sx: number; sz: number; gx: number; gz: number }>();
  feedDockStats: Record<string, { arrivals: number; busySec: number }> = {};
  /** Distance an AMR must be from a station before the next AMR may head to it (two footprints + margin). */
  private clearDistance(agent: FactoryAgent) {
    return agent.dispatch.radius * 2 + FEED_CLEAR_MARGIN;
  }
  /** A loaded feed AMR waits this far from the unload dock until the previous one has unloaded and cleared it. */
  private dockStageDistance(agent: FactoryAgent) {
    return this.clearDistance(agent) + agent.dispatch.radius * 2;
  }
  /**
   * Feed staging point off the shared dock lane: the AMR leaving the dock (back along that lane, empty pallet on its
   * deck) must pass the waiting one with full AMR clearance. Picks the shortest detour among a few points around the
   * dock at the staging radius; keeps the on-lane stop when none is reachable.
   */
  private sideStage(dock: SceneEquipment, layout: FactoryLayout, obstacles: NavigationObstacle[], routes: DispatchRoutes) {
    const feed = routes.feed;
    if (!feed?.dockStage) return;
    const lanes = [routes.dispatch, routes.returning];
    const off = (p: Vector3) => Math.min(...lanes.map((lane) => polylineDistance(p, lane)));
    const need = 2 * CYCLE_CONFIG.amrClearance + 0.3;
    // From the approach point in front of the belt (the receive pose itself hugs the belt inside its nav clearance).
    const head = routes.dispatch.slice(0, routes.dispatch.length > 1 ? 1 : 0), start = routes.dispatch[head.length];
    let best: { stage: Vector3; toStage: Vector3[]; toDock: Vector3[]; cost: number } | null = null;
    for (const radius of [feed.dockStage, feed.dockStage + 1.5])
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, stage = new Vector3(dock.x + Math.sin(a) * radius, 0, dock.z + Math.cos(a) * radius);
        if (off(stage) < need) continue;
        const cheap = start.distanceTo(stage) + radius;
        if (best && cheap >= best.cost) continue;
        const toStage = layoutPath(layout, start, stage, true, obstacles);
        const toDock = toStage && layoutPath(layout, stage, dock, true, obstacles);
        if (!toStage || !toDock) continue;
        const cost = pathLength(toStage) + pathLength(toDock);
        if (!best || cost < best.cost) best = { stage, toStage, toDock, cost };
      }
    // Detour worth at most ~25 m extra driving; otherwise the on-lane stop stays.
    if (!best || best.cost > pathLength(routes.dispatch) + 25) return;
    routes.dispatch = [...head, ...best.toStage, ...best.toDock.slice(1)];
    feed.stage = head.length + best.toStage.length - 1;
  }
  private releaseFeedDocks() {
    this.feedDockLeaving = this.feedDockLeaving.filter(({ dock, agent }) => {
      const p = agent.dispatch.carrier.position, phase = agent.dispatch.phase;
      // Also release when the leaver stopped nearby (idle / blocked) or was disabled: the booking leaked before and
      // kept the dock gate shut for every other AMR (an idle one parked there now steps aside on demand).
      const stuck = phase === "idle" || phase === "blocked" || this.settings()[agent.object.id]?.enabled === false;
      if (!stuck && Math.hypot(p.x - dock.x, p.z - dock.z) < this.clearDistance(agent)) return true;
      this.feedDockQueue.set(dock.id, (this.feedDockQueue.get(dock.id) ?? []).filter((a) => a !== agent));
      return false;
    });
  }
  get heldPalletBelts() {
    return this.palletHolds.map((h) => ({
      beltId: h.belt.id, pallet: h.pallets.length > 0, count: h.pallets.length, distance: h.pallets[0]?.distance ?? 0,
      distances: h.pallets.map((p) => p.distance), atStopper: this.palletAtStopper(h),
      agent: h.pallets[0]?.agent?.object.id ?? null, fed: h.fed ?? 0, arrivals: h.arrivals,
    }));
  }
  private palletAtStopper(hold: PalletHold) {
    const lead = hold.pallets[0];
    return !!lead && lead.distance >= beltLength(hold.belt) - STREAM_CONFIG.palletDepth / 2 - 1e-6;
  }
  /** Lead pallet resting on the stopper with no AMR ready under it: the belt is stopped. */
  private palletHalted(hold: PalletHold) {
    return this.palletAtStopper(hold) && !hold.pallets[0].agent?.dispatch.readyToReceive;
  }
  private holdWarn(hold: PalletHold, key: string, message: string, detail?: string) {
    if (hold.warned === key) return;
    hold.warned = key;
    log("warning", `${hold.belt.name}: ${message}`, detail);
  }
  private receivePoint(belt: SceneEquipment) {
    const pose = receivePose(belt);
    return { ...pose, v: new Vector3(pose.x, 0, pose.z) };
  }
  /** Picks an AMR and routes it: empty to the receive pose, loaded to a free unload dock, empty back home. */
  private dispatchFeed(hold: PalletHold, held: HeldPallet, settings: Record<string, EquipmentSettings>) {
    const claimed = new Set(this.palletHolds.flatMap((h) => h.pallets.map((p) => p.agent)).filter(Boolean));
    const mounted = new Set(Object.values(settings).map((c) => c?.mountedOn).filter(Boolean));
    const free = (a: FactoryAgent) => settings[a.object.id]?.enabled && a.dispatch.available && !a.charging && a.battery >= AMR_BATTERY.chargeBelow && !claimed.has(a) && !mounted.has(a.object.id);
    const linkedIds = this.links.outgoing(hold.belt.id, "feed");
    let candidates: FactoryAgent[];
    if (!linkedIds.length && !this.auto) {
      this.holdWarn(hold, "noLink", noLink("공급(컨베이어 → AMR)"), "자동 연결이 꺼져 있습니다 · 🔗 공급 링크를 추가하거나 자동 연결을 켜세요");
      for (const a of this.agents) if (a.dispatch.available && !a.waitingReason) a.waitingReason = noLink("공급");
      return;
    }
    if (linkedIds.length) {
      candidates = this.agents.filter((a) => linkedIds.includes(a.object.id));
      if (!candidates.length && linkedIds.some((id) => !this.robots.some((r) => r.object.id === id) && !this.unloadDocks.some((d) => d.id === id) && !this.scanners.some((sc) => sc.id === id))) {
        this.holdWarn(hold, "linkedRole", "🔗 연결된 AMR이 팔레트를 받을 수 없는 역할입니다", "팔레트 AMR(빈 상판)로 바꾸거나 연결을 수정하세요");
        return;
      }
      if (!candidates.length) candidates = this.agents.filter(free);
      else candidates = candidates.filter(free);
      if (!candidates.length) { this.holdWarn(hold, "linkedBusy", "🔗 연결된 AMR이 작업 중 · 빈 상태가 되면 받으러 갑니다"); return; }
    } else {
      candidates = this.agents.filter(free);
      if (!candidates.length) {
        this.holdWarn(hold, "none", "팔레트를 받을 빈 팔레트 AMR이 없어 컨베이어 끝에서 대기", "팔레트 AMR을 두거나 🔗 공급(컨베이어 → AMR)으로 연결하세요 · AMR이 비면 자동 출동");
        return;
      }
    }
    // An AMR homed at this belt's receive pose owns the station: any other AMR would wait behind it forever.
    const station = this.receivePoint(hold.belt);
    const owner = this.agents.find((a) => Math.hypot(a.dispatch.home.x - station.x, a.dispatch.home.z - station.z) < 1.5);
    if (owner && !linkedIds.length) {
      candidates = candidates.filter((a) => a === owner);
      if (!candidates.length) { this.holdWarn(hold, "owner", `받는 위치 전용 AMR(${owner.object.name})이 작업 중 · 비면 받으러 갑니다`); return; }
    }
    // Inbound boxes must pass the scanner: only docks a scan-line start robot unloads (🔗-linked robot/dock first).
    const starts = this.depalletizers.filter((r) => settings[r.object.id]?.enabled && this.scanStart(r, settings));
    // Box AMR (amrCargo "box", boxUnload "self", default): drives to a scanner line's belt start (a scanner's own
    // tunnel belt included) and rolls the boxes off its deck straight onto it; boxUnload "robot" uses the robot instead.
    // Pallet AMR: boxes on a pallet always need a scan-start robot (no self-unload; validation warns without one).
    const selfUnloads = (a: FactoryAgent) => settings[a.object.id]?.amrCargo === "box" && (settings[a.object.id]?.boxUnload ?? "self") === "self";
    const selfFeed = candidates.some(selfUnloads) ? this.selfFeedDocks(settings) : [];
    if (!starts.length && !selfFeed.length) {
      // Partial layout: the receive step still runs; the AMR keeps the pallet on its deck at home (next stage missing).
      this.parkFeed(hold, held, candidates, candidates.some(selfUnloads) ? "스캐너 라인 없음" : this.missingScanRobot(linkedIds, settings));
      return;
    }
    const served = (d: SceneEquipment) => starts.some((r) => distance(r.object, d) <= (settings[r.object.id]?.reach ?? 0) + 1.5);
    const linkedTargets = new Set(linkedIds);
    const scanDocks = [...(starts.length ? this.unloadDocks.filter(served) : []), ...selfFeed];
    // 🔗 conveyor → scanner: unload at that scanner (its own tunnel-belt self-feed dock, or a dock its start robot serves).
    const linkedScanners = this.scanners.filter((sc) => linkedTargets.has(sc.id));
    // A start robot feeds a scanner when its reach covers that scanner's belt between the entry and the tunnel.
    const feeds = (r: FactoryRobot, sc: SceneEquipment) => { const e = scannerEntry(sc), reach = (settings[r.object.id]?.reach ?? 0) - ROBOT_PICKING.pickReachMargin; for (let f = 0; f <= 1; f += 0.05) if (Math.hypot(r.object.x - (e.x + (sc.x - e.x) * f), r.object.z - (e.z + (sc.z - e.z) * f)) <= reach) return true; return false; };
    const atScanner = (d: SceneEquipment) => linkedScanners.some((sc) => d.id === `deckfeed:${scannerBeltId(sc.id)}` || starts.some((r) => feeds(r, sc) && distance(r.object, d) <= (settings[r.object.id]?.reach ?? 0) + 1.5));
    const preferred = scanDocks.filter((d) => linkedTargets.has(d.id) || atScanner(d) || starts.some((r) => linkedTargets.has(r.object.id) && distance(r.object, d) <= (settings[r.object.id]?.reach ?? 0) + 1.5));
    // One AMR at the dock (booked until it has unloaded and driven clear) plus one waiting at the staging distance.
    // 🔗 conveyor → scanner: only the linked scanner(s); never fall back to another scanner.
    if (linkedScanners.length && !preferred.length) {
      this.holdWarn(hold, "linkedScanner", `🔗 연결된 ${linkedScanners.map((sc) => sc.name).join(", ")} 입구에 쓸 수 있는 하역 로봇/하역 위치가 없어 대기`, this.missingScanRobot(linkedIds, settings));
      for (const a of candidates) a.waitingReason = this.missingScanRobot(linkedIds, settings);
      hold.routeRetryAt = this.elapsed + 1;
      return;
    }
    const docks = (preferred.length ? preferred : scanDocks).filter((d) => settings[d.id]?.enabled !== false && !this.shipments.some((sh) => sh.dock.id === d.id) && (this.feedDockQueue.get(d.id)?.length ?? 0) < FEED_DOCK_BOOKINGS);
    if (!scanDocks.length) {
      this.parkFeed(hold, held, candidates, "스캐너 시작 로봇 옆 하역 위치(dock) 없음");
      return;
    }
    if (!docks.length) {
      if (this.unloadDocks.length) this.holdWarn(hold, "dock", "하역 위치가 비기를 대기");
      else this.parkFeed(hold, held, candidates, "하역 위치(dock: 하역) 없음");
      return;
    }
    const receive = this.receivePoint(hold.belt);
    const length = (path: Vector3[] | null) => path ? path.reduce((sum, p, i) => sum + (i ? p.distanceTo(path[i - 1]) : 0), 0) : Infinity;
    let best: { agent: FactoryAgent; dock: SceneEquipment; layout: FactoryLayout; obstacles: NavigationObstacle[]; routes: DispatchRoutes; cost: number } | null = null;
    for (const dock of docks) {
      const robot = [...this.robots].sort((a, b) => distance(a.object, dock) - distance(b.object, dock))[0];
      const obstacles: NavigationObstacle[] = [
        ...this.wallObstacles,
        ...this.robots.filter((r) => r !== robot).map((r) => ({ kind: r.object.kind, pose: r.object })),
        ...this.belts.filter((b) => b.object.id !== hold.belt.id).map((b) => ({ kind: b.object.kind, pose: b.object })),
        ...this.pallets.filter((p) => !p.shipping).map((p) => ({ kind: p.object.kind, pose: p.object })),
        ...this.racks.map((r) => ({ kind: r.kind, pose: r })),
        ...this.outboundBelts.map((b) => ({ kind: b.kind, pose: b })),
      ];
      for (const agent of candidates) {
        if (dock.id.startsWith("deckfeed:") !== selfUnloads(agent)) continue;
        const from = agent.dispatch.carrier.position;
        const layout: FactoryLayout = { robot: robot?.object ?? { x: 1e4, z: 1e4, yaw: 0 }, conveyor: hold.belt, pallet: { x: receive.x, z: receive.z, yaw: receive.yaw }, amr: { x: from.x, z: from.z, yaw: 0 }, dock };
        // The receive pose hugs the belt end (inside the belt's nav clearance): route to an approach point straight out
        // from it, then creep the final straight leg in/out, like a dock approach.
        let pickup: Vector3[] | null = null, approach = receive.v;
        const fwd = { x: Math.sin(receive.yaw), z: Math.cos(receive.yaw) }, side = { x: fwd.z, z: -fwd.x };
        const at = (back: number, lateral = 0) => new Vector3(receive.x + fwd.x * back + side.x * lateral, 0, receive.z + fwd.z * back + side.z * lateral);
        for (const back of [0, 0.5, 1, 1.5, 2, 2.5]) {
          approach = at(back);
          const path = layoutPath(layout, layout.amr, { x: approach.x, z: approach.z }, false, obstacles);
          if (path) { pickup = back ? [...path, receive.v.clone()] : path; break; }
        }
        // Already parked at the receive pose (inside the belt clearance, so no path starts there): receive in place,
        // then leave through the first approach point that reaches the dock.
        let leave: Vector3[] | null = null;
        if (!pickup && Math.hypot(from.x - receive.x, from.z - receive.z) < 1.5) {
          pickup = [new Vector3(from.x, 0, from.z)];
          for (const back of [0, 0.5, 1, 1.5, 2, 2.5]) {
            approach = at(back);
            leave = layoutPath(layout, approach, dock, true, obstacles);
            if (leave) break;
          }
        }
        if (!pickup) continue;
        const cost = length(pickup);
        leave ??= layoutPath(layout, approach, dock, true, obstacles);
        const outbound = leave && (approach.equals(receive.v) ? leave : [receive.v.clone(), ...leave]);
        // A home parked at the receive pose (inside the belt clearance): drive back to the approach point, then creep in.
        const home = agent.dispatch.home, homeAtBelt = Math.hypot(home.x - receive.x, home.z - receive.z) < 1.5;
        const back = outbound && homeAtBelt ? layoutPath(layout, dock, { x: approach.x, z: approach.z }, false, obstacles) : null;
        const returning = outbound && (layoutPath(layout, dock, home, false, obstacles) ?? (back && [...back, home.clone()]));
        if (!outbound || !returning) continue;
        // Load balancing: a dock with nobody booked beats any busy one (then shortest drive); a busy dock only takes
        // the next AMR (to its staging point) when every eligible dock is booked.
        const total = cost + length(outbound) + (this.feedDockQueue.get(dock.id)?.length ?? 0) * FEED_DOCK_BUSY_COST;
        if (best && total >= best.cost) continue;
        best = { agent, dock, layout, obstacles, routes: { pickup, dispatch: outbound, returning, feed: { heading: receive.yaw, lane: approach.equals(receive.v) ? at(1.4) : approach, dockStage: this.dockStageDistance(agent), dockGate: () => this.feedDockQueue.get(dock.id)?.[0] === agent && !this.unloadLoads.some((l) => l.dock.id === dock.id) && !this.feedDockLeaving.some((l) => l.dock.id === dock.id && l.agent !== agent) } }, cost: total };
      }
    }
    if (!best) {
      // Route search is expensive (every candidate × dock × approach): retry a failed one at most once per second.
      hold.routeRetryAt = this.elapsed + 1;
      this.holdWarn(hold, "route", "AMR가 받는 위치/하역 위치로 갈 경로가 없습니다", "컨베이어 끝 앞(0.95 m)과 하역 위치 주변을 비워 주세요");
      return;
    }
    const { agent, dock, layout, obstacles, routes } = best;
    this.sideStage(dock, layout, obstacles, routes);
    held.agent = agent;
    const queue = this.feedDockQueue.get(dock.id) ?? [];
    queue.push(agent);
    this.feedDockQueue.set(dock.id, queue);
    hold.warned = null;
    agent.waiting = false;
    agent.waitingReason = null;
    agent.target = hold.belt.name;
    agent.dispatch.configure(layout, obstacles);
    this.navigation.set(agent.object.id, { layout, obstacles });
    log("info", `${agent.object.name}: 입하 컨베이어 받는 위치로 이동`, `${hold.belt.name} → ${dock.name}`);
    const run = { group: held.group, boxes: held.boxes };
    // The AMR never sets the pallet down: it stays still at the dock while the dock robot depalletizes it on its deck,
    // then carries the empty pallet back (handed off there to the empty-pallet flow).
    routes.hold = this.holdOnDeck(run.group, agent);
    agent.dispatch.request(run.group, () => {
      const group = run.group;
      const boxes = run.boxes.sort((a, b) => b.node.getWorldPosition(new Vector3()).y - a.node.getWorldPosition(this.point).y);
      for (const box of boxes) box.state = "placed";
      for (const box of boxes) this.feedBoxIds.add(box.id);
      const deck = dock.id.startsWith("deckfeed:") ? this.beltById(dock.id.slice("deckfeed:".length)) : undefined;
      this.unloadLoads.push({ dock, group, boxes, palletId: undefined, top: 0, scan: true, keep: true, deck });
      // The booking is released once the AMR has driven clear of the dock (see releaseFeedDocks).
      this.feedDockLeaving.push({ dock, agent });
      (this.feedDockStats[dock.name] ??= { arrivals: 0, busySec: 0 }).arrivals++;
      agent.completed++;
      agent.target = null;
      log("info", `${agent.object.name}: 입하 팔레트 ${dock.name} 도착 · AMR 위에서 로봇이 하역`, `박스 ${boxes.length}`);
    }, routes);
  }
  /**
   * Next stage missing (no scanner line / unload dock): an AMR still receives the pallet at the belt end and carries
   * it back to its home, where it holds it on its deck (never set down, never unloaded) until the run is reset.
   * Deterministic: candidates keep scene order, ties keep the first.
   */
  private parkFeed(hold: PalletHold, held: HeldPallet, candidates: FactoryAgent[], missing: string) {
    const receive = this.receivePoint(hold.belt);
    const obstacles: NavigationObstacle[] = [
      ...this.wallObstacles,
      ...this.robots.map((r) => ({ kind: r.object.kind, pose: r.object })),
      ...this.belts.filter((b) => b.object.id !== hold.belt.id).map((b) => ({ kind: b.object.kind, pose: b.object })),
      ...this.pallets.filter((p) => !p.shipping).map((p) => ({ kind: p.object.kind, pose: p.object })),
      ...this.racks.map((r) => ({ kind: r.kind, pose: r })),
      ...this.outboundBelts.map((b) => ({ kind: b.kind, pose: b })),
    ];
    const fwd = { x: Math.sin(receive.yaw), z: Math.cos(receive.yaw) };
    let best: { agent: FactoryAgent; layout: FactoryLayout; routes: DispatchRoutes; park: SceneEquipment; cost: number } | null = null;
    // 셔틀 구역: the conveyor's floor zones replace the AMR home (nearest one no other parked AMR is bound for).
    const taken = this.zoneBookings;
    const zones = (this.settings()[hold.belt.id]?.shuttleZones ?? []).map((z, i) => ({ ...z, id: `shuttle:${hold.belt.id}:${i}` })).filter((z) => !taken.has(z.id));
    // Every zone holds a pallet (or is booked): wait at the stopper instead of parking on an AMR deck.
    if ((this.settings()[hold.belt.id]?.shuttleZones?.length ?? 0) && !zones.length) {
      this.holdWarn(hold, "zone", "셔틀 구역이 비기를 대기");
      return;
    }
    const zone = zones.sort((a, b) => Math.hypot(a.x - receive.x, a.z - receive.z) - Math.hypot(b.x - receive.x, b.z - receive.z))[0];
    for (const agent of candidates) {
      const home = agent.dispatch.home;
      const park = (zone
        ? { ...agent.object, id: zone.id, kind: "dock", name: `${hold.belt.name} 셔틀 구역`, x: zone.x, z: zone.z }
        : { ...agent.object, id: `park:${agent.object.id}`, kind: "dock", name: `${agent.object.name} 보관 위치`, x: home.x, z: home.z }) as SceneEquipment;
      const from = agent.dispatch.carrier.position;
      const layout: FactoryLayout = { robot: { x: 1e4, z: 1e4, yaw: 0 }, conveyor: hold.belt, pallet: { x: receive.x, z: receive.z, yaw: receive.yaw }, amr: { x: from.x, z: from.z, yaw: 0 }, dock: park };
      let pickup: Vector3[] | null = null, approach = receive.v;
      for (const back of [0, 0.5, 1, 1.5, 2, 2.5]) {
        approach = new Vector3(receive.x + fwd.x * back, 0, receive.z + fwd.z * back);
        const path = layoutPath(layout, layout.amr, { x: approach.x, z: approach.z }, false, obstacles);
        if (path) { pickup = back ? [...path, receive.v.clone()] : path; break; }
      }
      // Already parked at the receive pose (inside the belt clearance, so no path starts there): receive in place.
      let leave: Vector3[] | null = null;
      if (!pickup && Math.hypot(from.x - receive.x, from.z - receive.z) < 1.5) {
        pickup = [new Vector3(from.x, 0, from.z)];
        // Home is the receive pose itself (no zone): keep the pallet on the deck right there.
        if (!zone && Math.hypot(home.x - receive.x, home.z - receive.z) < 1.5) { approach = receive.v; leave = [receive.v.clone()]; }
        else for (const back of [0, 0.5, 1, 1.5, 2, 2.5]) {
          approach = new Vector3(receive.x + fwd.x * back, 0, receive.z + fwd.z * back);
          leave = layoutPath(layout, approach, park, true, obstacles);
          if (leave) break;
        }
      }
      if (!pickup) continue;
      leave ??= layoutPath(layout, approach, park, true, obstacles);
      if (!leave) continue;
      const dispatch = approach.equals(receive.v) ? leave : [receive.v.clone(), ...leave];
      const cost = pickup.reduce((sum, p, i) => sum + (i ? p.distanceTo(pickup![i - 1]) : 0), 0);
      if (best && cost >= best.cost) continue;
      best = { agent, layout, park, cost, routes: { pickup, dispatch, returning: [home.clone()], feed: { heading: receive.yaw, lane: approach }, hold: zone ? undefined : { busy: () => true, emptyHome: () => {} } } };
    }
    if (!best) {
      hold.routeRetryAt = this.elapsed + 1;
      this.holdWarn(hold, "route", `${missing} · AMR가 받는 위치로 갈 경로가 없습니다`, "컨베이어 끝 앞(0.95 m)을 비워 주세요");
      return;
    }
    const { agent, layout, routes, park } = best;
    held.agent = agent;
    hold.warned = null;
    agent.waiting = false;
    agent.waitingReason = null;
    agent.target = hold.belt.name;
    agent.dispatch.configure(layout, obstacles);
    this.navigation.set(agent.object.id, { layout, obstacles });
    log("warning", `${hold.belt.name}: 다음 단계 없음 (${missing}) · ${agent.object.name}이(가) 팔레트를 받아 보관 위치에서 대기`, "스캐너 라인·하역 로봇·하역 dock을 추가하면 이어서 진행됩니다");
    if (zone) {
      // 셔틀 구역: lower the pallet (with its boxes) onto the floor zone, free the AMR; a forklift takes it on.
      this.zoneBookings.add(park.id);
      log("info", `${hold.belt.name}: ${agent.object.name}이(가) 입하 팔레트를 ${park.name}에 내려놓으러 이동`, missing);
      agent.dispatch.request(held.group, () => {
        const group = held.group;
        group.parent?.updateWorldMatrix(true, false);
        this.root.updateWorldMatrix(true, false);
        this.root.attach(group);
        group.position.set(park.x, 0, park.z);
        const yaw = new Euler().setFromQuaternion(group.quaternion, "YXZ").y;
        group.rotation.set(0, (Math.PI / 2) * Math.round(yaw / (Math.PI / 2)), 0);
        for (const box of held.boxes) box.state = "placed";
        this.zonePallets.push({ zoneId: park.id, zone: park, group, boxes: held.boxes.map((b) => b.node), handoff: null });
        this.zoneDropped++;
        agent.completed++;
        agent.target = null;
        log("info", `${agent.object.name}: 입하 팔레트를 ${park.name}에 내려놓음 · 지게차 대기`, missing);
      }, routes);
      return;
    }
    agent.waitingReason = missing;
    agent.dispatch.request(held.group, () => {
      agent.target = `${park.name} (보관)`;
      agent.waitingReason = missing;
      log("info", `${agent.object.name}: 입하 팔레트 보관 중 · 다음 단계 없음`, missing);
    }, routes);
  }
  /** The previous receiver has driven clear of the receive pose (two footprints + margin). */
  private receiveClear(hold: PalletHold) {
    const leaving = hold.leaving;
    if (!leaving) return true;
    const p = leaving.dispatch.carrier.position, receive = this.receivePoint(hold.belt);
    if (Math.hypot(p.x - receive.x, p.z - receive.z) < this.clearDistance(leaving)) return false;
    hold.leaving = null;
    return true;
  }
  private spawnHeldPallet(hold: PalletHold) {
    const group = new Group();
    group.add(createPalletModel(this.palletAsset));
    const size = new Vector3(STREAM_CONFIG.palletWidth, STREAM_CONFIG.palletHeight, STREAM_CONFIG.palletDepth);
    const max = planStack(1, size, BOX_SIZES[0], 0).capacity * PALLET_STACKING.layers;
    const total = Math.max(1, Math.min(max, Math.round(this.settings()[hold.belt.id]?.palletBoxes ?? PALLET_STACKING.defaultBoxes)));
    const boxes = planStack(total, size, BOX_SIZES[0], 0).slots.map((slot) => {
      const node = new Group();
      node.add(this.boxAsset.clone(true));
      node.userData.cargo = true;
      const id = this.cargo.spawnBox({ t: this.elapsed, beltId: hold.belt.id });
      node.userData.boxId = id;
      node.position.copy(slot.position).add(new Vector3(0, STREAM_CONFIG.palletHeight + BOX_SIZES[0].y, 0));
      group.add(node);
      this.spawned++;
      const item: Cargo = { id, node, belt: hold.belt, distance: 0, state: "departing", attempted: new Set() };
      this.boxes.push(item);
      return item;
    });
    this.render(group);
    this.root.add(group);
    hold.pallets.push({ group, boxes, distance: STREAM_CONFIG.palletDepth / 2, agent: null });
    log("info", `${hold.belt.name}: 입하 팔레트 투입`, `박스 ${total}`);
  }
  private advancePalletHolds(dt: number) {
    const settings = this.settings();
    const pitch = STREAM_CONFIG.palletDepth + PALLET_FEED_GAP;
    this.releaseFeedDocks();
    for (const load of this.unloadLoads) if (load.scan) {
      const stat = this.feedDockStats[load.dock.name] ??= { arrivals: 0, busySec: 0 };
      stat.busySec += dt;
    }
    for (const hold of this.palletHolds) {
      const config = settings[hold.belt.id];
      if (!config?.enabled) continue;
      const halted = this.palletHalted(hold);
      // Interval spawning pauses while the stopper holds the line, and never drops a pallet onto the tail one.
      if (!halted) hold.timer += dt;
      const tail = hold.pallets[hold.pallets.length - 1];
      if (autoSpawns(config) && hold.timer >= spawnIntervalOf(config) && !halted && (!tail || tail.distance - STREAM_CONFIG.palletDepth / 2 >= pitch - 1e-6)) {
        hold.timer = 0;
        this.spawnHeldPallet(hold);
      }
      // One AMR per station: the next receiver is sent only after the previous one has fully left the receive pose.
      const lead = hold.pallets[0];
      if (lead && !lead.agent && this.elapsed >= (hold.routeRetryAt ?? 0) && this.receiveClear(hold)) this.dispatchFeed(hold, lead, settings);
      const length = beltLength(hold.belt), stop = length - STREAM_CONFIG.palletDepth / 2;
      const receive = this.receivePoint(hold.belt), end = beltPoint(hold.belt, length);
      const transfer = length + Math.hypot(receive.x - end.x, receive.z - end.z);
      const speed = beltSpeedOf(config) * dt;
      let ahead = Infinity;
      for (const held of hold.pallets) {
        const ready = held === hold.pallets[0] && !!held.agent?.dispatch.readyToReceive;
        const limit = Math.min(ready ? transfer : stop, ahead - pitch);
        held.distance = Math.max(held.distance, Math.min(held.distance + speed, limit));
        ahead = held.distance;
        const along = Math.min(held.distance, length), point = beltPoint(hold.belt, along), extra = held.distance - along;
        // Over the belt at belt height; across the gap it eases down to the AMR deck (roller transfer, never from the floor).
        const over = Math.max(0, Math.min(1, (held.distance - length) / Math.max(1e-6, transfer - length)));
        held.group.position.set(point.x + Math.sin(point.yaw) * extra, ROLLER_DECK + (AMR_DECK - ROLLER_DECK) * over, point.z + Math.cos(point.yaw) * extra);
        held.group.rotation.set(0, point.yaw, 0);
      }
      if (!lead?.agent?.dispatch.readyToReceive || lead.distance < transfer - 1e-6) continue;
      lead.agent.dispatch.received();
      hold.leaving = lead.agent;
      hold.pallets.shift();
      hold.fed = (hold.fed ?? 0) + 1;
      hold.arrivals.push(this.elapsed);
    }
  }
  /** Pallet cycle (shuttle AMR / Rack_m / AGV scenes); null otherwise. */
  readonly cycle: PalletCycle<Cargo> | null;
  /** Boxes that left the factory at the end of a ship (출하) conveyor. */
  shippedBoxes = 0;
  private cycleHost(palletAsset: Group): PalletCycleHost<Cargo> {
    return {
      root: this.root,
      cargo: this.cargo,
      elapsed: () => this.elapsed,
      settings: this.settings,
      emptyReturnTo: (amrId) => this.links.outgoing(amrId, "emptyReturn"),
      autoConnect: this.auto,
      plan: (from, to, loaded, extra) =>
        this.forkliftRoute(from, to, loaded, extra.map((c) => ({ kind: "amr" as const, pose: { x: c.x, z: c.z, yaw: 0 }, radius: c.r }))),
      render: (group) => this.render(group),
      unrender: (group) => this.unrender(group),
      newPallet: () => {
        const group = new Group();
        group.add(createPalletModel(palletAsset));
        this.render(group);
        return group;
      },
      loadedPallet: (beltId, pallet) => {
        const group = new Group();
        group.add(createPalletModel(palletAsset));
        this.render(group);
        // Boxes at the station's slot layout, in pallet-local coordinates (origin = pallet bottom centre).
        const local = new Vector3(), base = new Vector3(pallet.object.x, pallet.baseY, pallet.object.z);
        const belt = this.beltById(beltId)!;
        const boxes = pallet.slots.map((slot) => {
          const node = new Group();
          node.add(this.boxAsset.clone(true));
          node.userData.cargo = true;
          const id = this.cargo.spawnBox({ t: this.elapsed, beltId });
          node.userData.boxId = id;
          local.copy(slot).sub(base).applyAxisAngle(new Vector3(0, 1, 0), -pallet.object.yaw);
          node.position.copy(local);
          group.add(node);
          this.render(node);
          this.spawned++;
          const item: Cargo = { id, node, belt, distance: 0, state: "placed", pallet: pallet.object.id, attempted: new Set() };
          return item;
        });
        return { group, boxes };
      },
      inboundFed: (boxes) => {
        for (const box of boxes) this.feedBoxIds.add(box.id);
      },
      registerLoaded: (stationId, boxes) => {
        for (const box of boxes) {
          this.cargo.placeBox({ t: this.elapsed, robotId: box.belt.id, boxId: box.id, stationId });
          this.placed++;
        }
      },
      takePlaced: (stationId) => {
        const taken = this.boxes.filter((b) => b.state === "placed" && b.pallet === stationId);
        this.boxes = this.boxes.filter((b) => !taken.includes(b));
        return taken;
      },
      unload: (dock, group, boxes, palletId, keep, onEmpty) =>
        this.unloadLoads.push({ dock, group, boxes, palletId, top: 0, keep, onEmpty }),
      unloadBusy: (dockId) => this.unloadLoads.some((l) => l.dock.id === dockId),
      rackFree: (booked, accept) => {
        for (const rack of this.racks) {
          if ((accept && !accept(rack)) || !this.acceptsPallets(rack)) continue;
          const stored = this.rackStored.get(rack.id)!;
          const slots = RACK_CONFIG.slots.map((_, i) => i).sort((a, b) => RACK_CONFIG.slots[a].y - RACK_CONFIG.slots[b].y);
          for (const slot of slots)
            if (!stored[slot] && !booked.has(`${rack.id}:${slot}`) && !this.slotBookings.has(`${rack.id}:${slot}`))
              return { rack, slot };
        }
        return null;
      },
      rackStore: (rack, slot, group, boxes, palletId) => this.storeFromForklift({ boxes, palletId }, group, { rackId: rack.id, slot }),
      rackOldest: (claimed, accept) => {
        let best: { rack: SceneEquipment; slot: number; at: number } | null = null;
        for (const rack of this.racks)
          if (!accept || accept(rack)) this.rackPallets.get(rack.id)!.forEach((record, slot) => {
            const key = `${rack.id}:${slot}`;
            if (record && this.rackGroups.get(rack.id)![slot] && this.rackContent.get(rack.id)?.[slot] !== "boxes" && !claimed.has(key) && !this.unloadClaims.has(key) && (!best || record.storedAt < best.at))
              best = { rack, slot, at: record.storedAt };
          });
        return best;
      },
      rackTake: (rack, slot) => this.takeFromRack(rack, slot),
      log: (level, message, detail) => log(level, message, detail),
    };
  }
  /** Linked subset of `items` when `linked` is non-empty, else all of them (fallback). */
  private linkedOrAll<T>(items: readonly T[], linked: readonly string[], id: (item: T) => string) {
    if (!linked.length) return this.auto ? [...items] : [];
    const ids = new Set(linked);
    return items.filter((item) => ids.has(id(item)));
  }
  /** First robot linked to load `pallet`, if any. */
  private loaderOf(pallet: PalletController) {
    const ids = this.links.incoming(pallet.object.id, "load");
    return this.robots.find((robot) => ids.includes(robot.object.id)) ?? null;
  }
  private startPalletRecord(pallet: PalletController) {
    this.cargo.startPallet({ t: this.elapsed, stationId: pallet.object.id, grade: palletGrade(this.settings()[pallet.object.id]) });
  }
  private docks: SceneEquipment[] = [];
  /** Depalletizing robots (robotRole "depalletize", also in `robots`): unload-dock pallet -> belt. */
  readonly depalletizers: FactoryRobot[] = [];
  private unloadDocks: SceneEquipment[] = [];
  private unloadLoads: UnloadLoad[] = [];
  /** Belts with a depalletized box on its way (one drop at a time per belt). */
  private dropBooked = new Set<string>();
  readonly outboundBelts: SceneEquipment[] = [];
  private rolling: RollingPallet[] = [];
  /** Pallets that left through an outbound conveyor / boxes put on belts by depalletizers / emptied pallets. */
  outboundShipped = 0;
  depalletized = 0;
  emptiedPallets = 0;
  private racks: SceneEquipment[] = [];
  /** Filled PalletPoints per rack; stored pallets stay for the rest of the run. */
  private rackStored = new Map<string, boolean[]>();
  /** Display only: pallet stored in each rack slot (kept here; finished cargo records are evicted). */
  private rackPallets = new Map<string, ({ id: string; grade: CargoGrade; boxes: number; storedAt: number } | undefined)[]>();
  /** Scene nodes of stored pallets, so the forklift can take them out again. */
  private rackGroups = new Map<string, (StoredPallet | undefined)[]>();
  private doors: SceneEquipment[] = [];
  /** Door opening 0..1 driven by forklift traffic (sim time; display reads it). */
  private doorFraction = new Map<string, number>();
  /** "rackId:slot" pallets already claimed by a forklift job. */
  private unloadClaims = new Set<string>();
  /** Rack slots ("rack:slot") booked for a hand-off pallet until a forklift stores it. */
  private slotBookings = new Set<string>();
  private handoffs: Handoff[] = [];
  /** 셔틀 구역 ids booked by a feed trip or holding a dropped pallet (freed when a forklift lifts it). */
  private zoneBookings = new Set<string>();
  /** Pallets an AMR set down on a 셔틀 구역; each becomes a rack hand-off (handoff) once a rack slot is free. */
  private zonePallets: { zoneId: string; zone: SceneEquipment; group: Group; boxes: Group[]; handoff: Handoff | null }[] = [];
  /** Pallets set down on / lifted off 셔틀 구역 (flow-check). */
  zoneDropped = 0;
  zonePicked = 0;
  /** Pallets left at hand-off points / stored into racks by forklifts. */
  handedOff = 0;
  forkliftStored = 0;
  private rackUnloadRetry = 0;
  private rackLayout!: FactoryLayout;
  private rackObstacles: NavigationObstacle[] = [];
  private wallObstacles: NavigationObstacle[] = [];
  /** Pallets taken out of racks and shipped through a door. */
  unloaded = 0;
  /** What each filled slot holds (pallet-in = "pallet"/"palletBoxes", loose boxes on the shelf = "boxes"). */
  private rackContent = new Map<string, ("pallet" | "palletBoxes" | "boxes" | undefined)[]>();
  /** Every rack takes whole (full) pallets in; the rackStorage option was removed. */
  private acceptsPallets(_rack: SceneEquipment) {
    return true;
  }
  /** Initial slot contents (settings.rackContents): static stored pallets / loose boxes, stacked with the pallet stacking layout. */
  private seedRackContents(rack: SceneEquipment) {
    const contents = this.settings()[rack.id]?.rackContents ?? [];
    const kinds = RACK_CONFIG.slots.map(() => undefined as "pallet" | "palletBoxes" | "boxes" | undefined);
    this.rackContent.set(rack.id, kinds);
    const size = new Vector3(STREAM_CONFIG.palletWidth, STREAM_CONFIG.palletHeight, STREAM_CONFIG.palletDepth);
    const max = planStack(1, size, BOX_SIZES[0], 0).capacity * PALLET_STACKING.layers;
    for (const content of contents) {
      const slot = content.slot;
      if (!RACK_CONFIG.slots[slot] || this.rackStored.get(rack.id)![slot]) continue;
      const total = Math.max(0, Math.min(max, Math.round(content.boxes)));
      if (!content.pallet && !total) continue;
      const group = new Group();
      if (content.pallet) group.add(createPalletModel(this.palletAsset));
      const base = (content.pallet ? STREAM_CONFIG.palletHeight : 0) + BOX_SIZES[0].y;
      const boxes = total ? planStack(total, size, BOX_SIZES[0], 0).slots.map((s) => {
        const node = new Group();
        node.add(this.boxAsset.clone(true));
        node.userData.cargo = true;
        // Stock stored in a rack (from the layout / glb) counts as already inspected (normal): never re-scanned.
        node.userData.inspected = true;
        node.position.copy(s.position).add(new Vector3(0, base, 0));
        group.add(node);
        return node;
      }) : [];
      group.position.copy(rackSlotPoint(rack, slot));
      group.rotation.set(0, rack.yaw, 0);
      group.userData.instanceStatic = true;
      this.root.add(group);
      this.render(group);
      for (const box of boxes) this.render(box);
      this.rackStored.get(rack.id)![slot] = true;
      kinds[slot] = !content.pallet ? "boxes" : total ? "palletBoxes" : "pallet";
      this.rackPallets.get(rack.id)![slot] = { id: `${rack.name}-${RACK_CONFIG.slots[slot].name}`, grade: "normal", boxes: total, storedAt: 0 };
      this.rackGroups.get(rack.id)![slot] = { group, boxes };
    }
  }
  /** First PalletPoint that is neither filled nor booked by a delivery in progress. */
  private freeSlot(rack: SceneEquipment) {
    if (!this.acceptsPallets(rack)) return -1;
    const stored = this.rackStored.get(rack.id) ?? [];
    return stored.findIndex(
      (filled, slot) =>
        !filled &&
        !this.slotBookings.has(`${rack.id}:${slot}`) &&
        !this.shipments.some((s) => s.dock.id === rack.id && s.slot === slot),
    );
  }
  private render(object: Group) {
    this.rendered.add(object);
    if (this.renderingActive) this.instances?.register(object);
  }
  private unrender(object: Group) {
    this.rendered.delete(object);
    this.instances?.unregister(object);
  }
  connectInstances() {
    if (this.renderingActive) return;
    this.renderingActive = true;
    for (const object of this.rendered) this.instances?.register(object);
  }
  dispose() {
    this.inspection.dispose();
    // Stop: every runtime registration goes, including boxes registered with their pallet and since taken off it.
    if (this.renderingActive) {
      for (const object of this.rendered) this.instances?.unregister(object, true);
      for (const box of this.boxes) this.instances?.unregister(box.node, true);
      this.instances?.releaseOrphans?.();
    }
    this.renderingActive = false;
  }
  private spawn(belt: SceneEquipment, offset = 0) {
    const node = new Group(),
      model = this.boxAsset.clone(true);
    node.add(model);
    node.rotation.y = belt.yaw;
    // Boxes are cargo, not part of the belt: no sceneId (see viewport/scene/sceneOwner).
    node.userData.cargo = true;
    const id = this.cargo.spawnBox({ t: this.elapsed, beltId: belt.id });
    node.userData.boxId = id;
    const item: Cargo = {
      id,
      node,
      belt,
      distance: offset,
      state: "moving",
      attempted: new Set(),
    };
    this.boxes.push(item);
    this.root.add(node);
    this.render(node);
    this.spawned++;
    this.move(item);
  }
  private beltById(id: string) {
    return this.belts.find((belt) => belt.object.id === id)?.object;
  }
  /** Belt ids sorted so every belt comes after the belt it feeds into (chain ends first). */
  private downstreamOrder() {
    const depth = new Map<string, number>();
    const depthOf = (id: string, seen: Set<string>): number => {
      const known = depth.get(id);
      if (known !== undefined) return known;
      const next = this.connections.get(id);
      if (!next || seen.has(next.id) || !this.beltById(next.id)) return 0;
      seen.add(id);
      const value = depthOf(next.id, seen) + 1;
      depth.set(id, value);
      return value;
    };
    for (const belt of this.belts) depth.set(belt.object.id, depthOf(belt.object.id, new Set()));
    return this.belts
      .map((belt) => belt.object.id)
      .sort((a, b) => depth.get(a)! - depth.get(b)! || (a < b ? -1 : 1));
  }
  private move(box: Cargo) {
    const point = beltPoint(
        box.belt,
        Math.min(box.distance, beltLength(box.belt)),
      ),
      s = Math.sin(point.yaw),
      c = Math.cos(point.yaw);
    box.node.position.set(point.x, CONVEYOR_LAYOUT.height + BOX_SIZES[0].y, point.z);
    box.node.rotation.y = point.yaw;
    if (box.job && box.state === "reserved") {
      box.job.pickup.copy(box.node.position);
      box.job
        .velocity!.set(s, 0, c)
        .multiplyScalar(box.speed ?? beltSpeedOf(this.settings()[box.belt.id]));
    }
  }
  private scanBeltTravel(box: Cargo, start: number, end: number) {
    if (!this.inspection.active || end <= start) return;

    const steps = Math.max(1, Math.ceil((end - start) / SCANNER_CONFIG.sampleDistance));
    const origin = beltPoint(box.belt, start);
    this.scanFrom.set(origin.x, box.node.position.y, origin.z);

    for (let step = 1; step <= steps; step++) {
      const point = beltPoint(box.belt, start + (end - start) * step / steps);
      this.scanTo.set(point.x, box.node.position.y, point.z);
      this.inspection.inspectMovement(box.node, this.scanFrom, this.scanTo);
      this.scanFrom.copy(this.scanTo);
    }
  }

  /** Last open belt of the line `id` feeds into, or null for a closed loop (no stopper). */
  private stopperBelt(id: string, settings: Record<string, EquipmentSettings>) {
    const seen = new Set<string>([id]);
    let current = id;
    for (;;) {
      const next = this.connections.get(current);
      if (!next || !settings[next.id]?.enabled || !this.beltById(next.id)) return current;
      if (seen.has(next.id)) return null;
      seen.add(next.id);
      current = next.id;
    }
  }
  /**
   * Belts whose whole line is stopped: a box touching the end stopper halts every connected
   * segment upstream of it (belt travel and box production) until the box is picked off.
   */
  haltedBelts(settings: Record<string, EquipmentSettings> = this.settings()) {
    const halted = this.haltedScratch;
    halted.clear();
    const blocked = new Set<string>();
    for (const box of this.boxes) {
      if (box.state !== "moving" && box.state !== "reserved") continue;
      if (this.stopperBelt(box.belt.id, settings) !== box.belt.id) continue;
      if (box.distance >= beltLength(box.belt) - BOX_SIZES[0].z / 2 - CONVEYOR_STOPPER_CONTACT)
        blocked.add(box.belt.id);
    }
    for (const hold of this.palletHolds) if (this.palletHalted(hold)) halted.add(hold.belt.id);
    if (!blocked.size) return halted;
    for (const belt of this.belts) {
      const end = this.stopperBelt(belt.object.id, settings);
      if (end && blocked.has(end)) halted.add(belt.object.id);
    }
    return halted;
  }

  advance(dt: number) {
    const settings = this.settings();
    this.elapsed += dt;
    this.kpi.tick(this.elapsed, this.kpiSample);
    for (const robot of this.robots)
      if (robot.busy && settings[robot.object.id].enabled)
        robot.busySeconds += dt;
    const halted = this.haltedBelts(settings);
    for (const belt of this.belts) {
      const config = settings[belt.object.id];
      // Belts fed by a depalletizing robot never spawn boxes themselves.
      if (!config.enabled || !autoSpawns(config) || this.incoming.has(belt.object.id) || config.conveyorRole === "fed" || config.conveyorRole === "ship" || isPalletInbound(settings, belt.object.id)) continue;
      // A line stopped at its stopper produces nothing; the feed timer resumes once it is cleared.
      if (halted.has(belt.object.id)) continue;
      // Real-time interval: independent of belt speed (a stopped belt simply blocks its inlet).
      const interval = spawnIntervalOf(config);
      belt.elapsed += dt;
      if (belt.elapsed >= interval) {
        const inletOccupied = this.boxes.some(
          (box) =>
            (box.state === "moving" || box.state === "reserved") &&
            box.belt.id === belt.object.id &&
            box.distance < BOX_SIZES[0].z + 0.08,
        );
        if (!inletOccupied) {
          // Defensive: at most one box per belt per step, no unbounded backlog for tiny intervals.
          belt.elapsed = Math.min(belt.elapsed - interval, interval);
          this.spawn(belt.object);
        } else belt.elapsed = interval;
      }
    }
    let removed = false;
    // End stopper + accumulation: boxes stop at the chain end and queue behind the box ahead.
    const queues = this.queueScratch, tails = this.tailScratch;
    for (const list of queues.values()) list.length = 0;
    tails.clear();
    for (const box of this.boxes) {
      if (box.state !== "moving" && box.state !== "reserved") continue;
      let list = queues.get(box.belt.id);
      if (!list) queues.set(box.belt.id, (list = []));
      list.push(box);
    }
    const order = this.beltOrder ?? (this.beltOrder = this.downstreamOrder());
    const gap = BOX_SIZES[0].z + 0.05;
    // Distance along a belt (from its start) where the next box's centre may be at most, i.e. the
    // position of the rearmost box on it, or the stopper/downstream tail when it is empty.
    const tailOf = (id: string): number => {
      const known = tails.get(id);
      if (known !== undefined) return known;
      const belt = this.beltById(id);
      return belt ? beltLength(belt) - BOX_SIZES[0].z / 2 + gap : Infinity;
    };
    for (const id of order) {
      const list = queues.get(id);
      const belt = this.beltById(id)!;
      const length = beltLength(belt);
      const next = this.connections.get(id);
      const nextOpen = next && settings[next.id].enabled;
      let limit = nextOpen ? length + tailOf(next.id) - gap : length - BOX_SIZES[0].z / 2;
      if (list && list.length) {
        if (list.length > 1) list.sort((a, b) => b.distance - a.distance || (a.id < b.id ? -1 : 1));
        for (const box of list) {
          const config = settings[box.belt.id];
          let scanStart = box.distance;
          const before = box.distance;
          if (config.enabled && !halted.has(box.belt.id))
            box.distance = Math.max(before, Math.min(before + dt * beltSpeedOf(config), limit));
          box.speed = dt > 0 ? (box.distance - before) / dt : 0;
          // Boxes cross segment joints into the next open segment.
          for (
            let hops = 0;
            box.distance > beltLength(box.belt) && hops < this.belts.length;
            hops++
          ) {
            const following = this.connections.get(box.belt.id);
            if (!following || !settings[following.id].enabled) {
              box.distance = beltLength(box.belt);
              break;
            }
            this.scanBeltTravel(box, scanStart, beltLength(box.belt));
            scanStart = 0;
            box.distance -= beltLength(box.belt);
            box.belt = following;
            this.cargo.moveBox(box.id, following.id);
          }
          this.scanBeltTravel(box, scanStart, Math.min(box.distance, beltLength(box.belt)));
          this.move(box);
          // Position of this box expressed on the current belt, for the box behind it.
          const own = box.belt.id === id ? box.distance : length + box.distance;
          limit = Math.min(limit, own - gap);
          if (box.belt.id !== id) tails.set(box.belt.id, Math.min(tails.get(box.belt.id) ?? Infinity, box.distance));
        }
      }
      tails.set(id, Math.min(tails.get(id) ?? Infinity, limit + gap));
    }
    for (const box of this.boxes) {
      // Ship (출하) conveyor: a box reaching its end leaves the factory.
      const shipped = box.state === "moving" && settings[box.belt.id]?.conveyorRole === "ship" &&
        !this.connections.get(box.belt.id) && box.distance >= beltLength(box.belt) - BOX_SIZES[0].z / 2 - CONVEYOR_STOPPER_CONTACT - 1e-3;
      if (shipped) this.shippedBoxes++;
      // Legacy safety net (should not trigger with the end stopper).
      if (shipped || (box.distance > beltLength(box.belt) + 1 && box.state === "moving")) {
        box.state = "passed";
        if (this.feedBoxIds.delete(box.id)) this.feedScan.unscanned++;
        this.cargo.passBox({ t: this.elapsed, boxId: box.id, beltId: box.belt.id });
        box.node.removeFromParent();
        this.unrender(box.node);
        this.passed++;
        removed = true;
      }
    }
    if (removed)
      this.boxes = this.boxes.filter((box) => box.state !== "passed");
    this.advanceDepalletizers(settings, halted);
    this.advanceDeckFeeds(dt, settings, halted);
    this.advanceOutbound(dt, settings);
    // Pickable boxes (moving, not on a ship belt) with their grade, computed once per step instead of once per
    // robot × pallet; this loop dominated the step at high speed with many robots.
    // Scratch arrays are reused across steps (no per-step filter/map/closure allocations); same order, same boxes.
    let pickable = false;
    const pickBoxes = this.pickBoxes, pickGrades = this.pickGrades, nearBoxes = this.nearBoxes, nearGrades = this.nearGrades;
    for (const robot of this.robots) {
      const config = settings[robot.object.id];
      if (robot.busy || !config.enabled || this.depalletizers.includes(robot)) continue;
      if (!pickable) {
        pickable = true;
        pickBoxes.length = 0;
        pickGrades.length = 0;
        for (const box of this.boxes)
          if (box.state === "moving" && settings[box.belt.id]?.conveyorRole !== "ship") {
            pickBoxes.push(box);
            pickGrades.push(this.grade(box));
          }
      }
      // Boxes this robot could take regardless of pallet (feed belt, reach, not yet attempted), in box order.
      const feed = this.feedBelts.get(robot.object.id);
      nearBoxes.length = 0;
      nearGrades.length = 0;
      for (let i = 0; i < pickBoxes.length; i++) {
        const box = pickBoxes[i];
        if (
          (!feed || feed.has(box.belt.id)) &&
          !box.attempted.has(robot.object.id) &&
          distance(robot.object, box.node.position) <= config.reach - 0.05
        ) {
          nearBoxes.push(box);
          nearGrades.push(pickGrades[i]);
        }
      }
      const reachArm = config.reach - ROBOT_PICKING.armReachMargin;
      if (!nearBoxes.length) {
        // A box for this robot (feed belt, grade) waiting just outside the reach: say how far, not "waiting".
        let near = Infinity;
        for (let i = 0; i < pickBoxes.length; i++) {
          const box = pickBoxes[i];
          if ((feed && !feed.has(box.belt.id)) || ((config.pickFilter ?? "all") !== "all" && pickGrades[i] !== config.pickFilter)) continue;
          near = Math.min(near, distance(robot.object, box.node.position));
        }
        robot.warning = near <= config.reach + 1
          ? `손이 닿지 않음: ${near.toFixed(2)} m, 로봇을 ${Math.max(0.05, near - reachArm).toFixed(2)} m 더 가까이`
          : undefined;
        continue;
      }
      let tooFar = Infinity;
      const filter = config.pickFilter ?? "all";
      // Grades that have a pallet within this robot's reach. With the "all" filter a box
      // goes to a pallet of its own grade when one exists, otherwise to any pallet (legacy).
      const reachable = this.reachableScratch;
      reachable.clear();
      for (const pallet of this.palletOrder.get(robot.object.id)!)
        if (
          settings[pallet.object.id].enabled &&
          pallet.slots.some((slot) => distance(robot.object, slot) <= config.reach)
        )
          reachable.add(palletGrade(settings[pallet.object.id]));
      let assigned = false;
      for (const pallet of this.palletOrder.get(robot.object.id)!) {
        if (
          pallet.shipping ||
          !settings[pallet.object.id].enabled ||
          pallet.availableSlot < 0
        )
          continue;
        const slot = pallet.availableSlot,
          target = pallet.slots[slot],
          grade = palletGrade(settings[pallet.object.id]);
        if (distance(robot.object, target) > config.reach) continue;
        for (let n = 0; n < nearBoxes.length; n++) {
          const box = nearBoxes[n], boxGrade = nearGrades[n];
          // Non-matching boxes are left on the belt and continue downstream.
          // Strict grade separation: box grade = robot filter (when set) = pallet grade. Others stay on the belt.
          if (filter !== "all" && boxGrade !== filter) continue;
          if (boxGrade !== grade) continue;
          const speed = box.speed ?? beltSpeedOf(settings[box.belt.id]);
          // Where the box will be at contact (approach + descent). A box that will have left the reach or the
          // belt (reserved boxes stop at its end and are then given up) by then is left for downstream.
          const nextBelt = this.connections.get(box.belt.id);
          // At the chain end the box stops at the stopper, so it never leaves the belt.
          const contactDistance = Math.min(
            box.distance + speed * ROBOT_PICKING.pickLeadSeconds,
            nextBelt ? Infinity : Math.max(box.distance, beltLength(box.belt) - BOX_SIZES[0].z / 2),
          );
          // Past a joint the box continues on the next segment (reserved boxes cross joints too).
          const predicted = nextBelt && contactDistance > beltLength(box.belt)
            ? beltPoint(nextBelt, Math.min(contactDistance - beltLength(box.belt), beltLength(nextBelt)))
            : beltPoint(box.belt, contactDistance);
          this.point.set(predicted.x, box.node.position.y, predicted.z);
          if (distance(robot.object, this.point) > reachArm) {
            // Within the nominal reach but past what the arm can solve: warn instead of freezing on the pick.
            if (distance(robot.object, this.point) <= config.reach) tooFar = Math.min(tooFar, distance(robot.object, this.point));
            continue;
          }
          this.assign(robot, pallet, slot, box);
          assigned = true;
          break;
        }
        if (assigned) break;
      }
      robot.warning = assigned || !Number.isFinite(tooFar)
        ? undefined
        : `손이 닿지 않음: ${tooFar.toFixed(2)} m, 로봇을 ${Math.max(0.05, tooFar - reachArm).toFixed(2)} m 더 가까이`;
    }
    for (const vehicle of this.trafficVehicles) {
      vehicle.speed = amrSpeedFactor(settings[vehicle.id]);
      vehicle.enabled = settings[vehicle.id].enabled;
    }
    const forkliftBodies = this.forkliftAgents
      .filter((agent) => settings[agent.object.id].enabled)
      // Capsule footprint as a row of circles (body + tines), so clearance matches the model.
      .flatMap((agent) => agent.controller.bodies.map((position) => ({ position, radius: agent.controller.radius, owner: agent.object.id })));
    this.trafficTick++;
    // Move guards for the route-less moves (rack insert / retreat, forklift turns and fork creeps); installed once per agent.
    for (const agent of this.agents) agent.dispatch.guard ??= this.amrGuard(agent);
    for (const agent of this.forkliftAgents) agent.controller.guard ??= this.forkliftGuard(agent);
    this.trafficBodies = forkliftBodies;
    this.traffic.advance(this.trafficVehicles, dt, this.trafficPlan, forkliftBodies);
    this.advanceBatteries(dt, settings);
    this.advanceForklifts(dt, settings);
    this.advanceEmptyPicks(settings);
    this.cycle?.advance(dt);
    this.advancePalletHolds(dt);
    for (const shipment of this.shipments) {
      if (shipment.replaced || shipment.agent.dispatch.phase !== "dispatch")
        continue;
      const pose = shipment.pallet.object,
        position = shipment.agent.dispatch.carrier.position;
      const dx = position.x - pose.x,
        dz = position.z - pose.z,
        c = Math.cos(pose.yaw),
        s = Math.sin(pose.yaw);
      const cleared =
        Math.abs(dx * c - dz * s) >
          STREAM_CONFIG.palletWidth + AMR_TRAFFIC.safetyMargin ||
        Math.abs(dx * s + dz * c) >
          STREAM_CONFIG.palletDepth + AMR_TRAFFIC.safetyMargin;
      const occupied = this.agents.some((agent) => {
        if (agent === shipment.agent) return false;
        const x = agent.dispatch.carrier.position.x - pose.x,
          z = agent.dispatch.carrier.position.z - pose.z;
        const clearance = Math.hypot(
          Math.max(0, Math.abs(x * c - z * s) - STREAM_CONFIG.palletWidth / 2),
          Math.max(0, Math.abs(x * s + z * c) - STREAM_CONFIG.palletDepth / 2),
        );
        return clearance < agent.dispatch.radius + AMR_TRAFFIC.safetyMargin;
      });
      if (cleared && !occupied) this.replacePallet(shipment);
    }
    // A dropped pallet stays on its dock until the delivering AMR has driven clear.
    const pending = this.shipmentScratch;
    pending.length = 0;
    for (const shipment of this.shipments) pending.push(shipment);
    for (const shipment of pending) {
      if (shipment.stored) {
        this.finishStorage(shipment);
        continue;
      }
      if (!shipment.dropped) continue;
      const at = shipment.agent.dispatch.carrier.position;
      if (
        shipment.agent.dispatch.phase === "idle" ||
        distance(at, shipment.dock) >
          Math.hypot(STREAM_CONFIG.palletWidth, STREAM_CONFIG.palletDepth) / 2 +
            shipment.agent.dispatch.radius +
            AMR_TRAFFIC.safetyMargin
      )
        this.clearDock(shipment);
    }
    this.dispatchRetry -= dt;
    if (this.dispatchRetry > 0) return;
    this.dispatchRetry = 1;
    const resuming = this.dispatchSkip > 0;
    if (!resuming)
      for (const agent of this.agents)
        if (agent.dispatch.available) {
        agent.waiting = false;
        agent.waitingReason = null;
      }
    const ready = this.pallets.filter(
      (pallet) =>
        !pallet.shipping &&
        settings[pallet.object.id].enabled &&
        pallet.full,
    );
    // Pallet stations with neither a robot (to load / unload them) nor an AMR (to move them): no process flow at all.
    if (!this.cycle && this.pallets.some((p) => settings[p.object.id]?.enabled) &&
      !this.robots.some((r) => settings[r.object.id]?.enabled) && !this.agents.some((a) => settings[a.object.id]?.enabled))
      this.warnOnce(NO_FLOW, this.pallets[0].object.name);
    // A full station raises a transport task (FIFO by the time it became ready).
    for (const pallet of ready) {
      pallet.readyAt ??= this.elapsed;
      if (!this.fullReported.has(pallet)) {
        this.fullReported.add(pallet);
        this.cargo.completePallet({ t: pallet.readyAt, stationId: pallet.object.id });
      }
      this.transport.request({ t: pallet.readyAt, stationId: pallet.object.id, palletId: this.cargo.currentPallet(pallet.object.id)?.id });
    }
    ready.sort((a, b) => a.readyAt! - b.readyAt!);
    // Each ship() attempt can run several grid path searches (pickup, outbound and return per
    // destination). Running every pallet x AMR pair in one frame stalled the frame right when a
    // drop freed a dock/slot, so a round is capped and resumed a few ticks later.
    let budget = SHIP_ATTEMPTS_PER_TICK, pair = 0, cut = false;
    rounds: for (const pallet of ready) {
      // Fleet assignment: AMRs linked to this station (all when none are linked), idle, enabled and
      // not charging (fixed chargeBelow threshold); nearest first, fewer deliveries on a tie.
      const agents = this.linkedOrAll(this.agents, this.links.incoming(pallet.object.id, "pickup"), (a) => a.object.id).filter(
        // An empty AMR on its way home counts as free: it drives from where it is straight to the next pallet
        // (unless its battery needs charging first).
        (a) =>
          settings[a.object.id].enabled &&
          a.dispatch.available &&
          !a.charging &&
          a.battery >= AMR_BATTERY.chargeBelow,
      );
      if (!this.auto && !this.links.incoming(pallet.object.id, "pickup").length) {
        this.warnOnce(noLink("픽업(AMR → 팔레트)"), pallet.object.name);
        continue;
      }
      if (!agents.length) {
        // No AMR can take it at all: a forklift carries the pallet to the outbound robot instead.
        // (Pallets riding on shuttles / handled by the pallet cycle are not floor pallets.)
        if (!this.agents.some((a) => settings[a.object.id].enabled) && !settings[pallet.object.id]?.mountedOn && !this.cycle)
          this.forkliftShip(pallet, settings);
        continue;
      }
      const away = (a: FactoryAgent) => distance(a.dispatch.carrier.position, pallet.object);
      agents.sort((a, b) => away(a) - away(b) || a.completed - b.completed);
      for (const agent of agents) {
        if (pair++ < this.dispatchSkip) continue;
        if (budget-- <= 0) {
          cut = true;
          break rounds;
        }
        if (this.ship(pallet, agent)) break;
        agent.waiting = true;
      }
    }
    if (cut) {
      this.dispatchSkip = pair - 1;
      this.dispatchRetry = SHIP_RESUME_S;
    } else this.dispatchSkip = 0;
  }
  /** Drain while moving, trickle while idle; an idle AMR below the threshold returns home and charges there. */
  private advanceBatteries(dt: number, settings: Record<string, EquipmentSettings>) {
    for (const agent of this.agents) {
      const config = settings[agent.object.id];
      if (!config.enabled) continue;
      const scaled = dt * amrSpeedFactor(config);
      const idle = agent.dispatch.phase === "idle";
      if (agent.charging) {
        agent.battery = Math.min(100, agent.battery + AMR_BATTERY.chargeRate * scaled);
        if (agent.battery >= AMR_BATTERY.chargedAt) agent.charging = false;
        continue;
      }
      agent.battery = Math.max(0, agent.battery - (idle ? AMR_BATTERY.idleDrain : AMR_BATTERY.movingDrain) * scaled);
      // A transfer in progress always finishes; once idle a low AMR goes to its own home spot and charges there.
      if (idle && agent.battery < AMR_BATTERY.chargeBelow) {
        // No path home (walled in): charge where it stands rather than stall.
        if (agent.dispatch.atHome || !agent.dispatch.goHome()) agent.charging = true;
      }
    }
  }
  /** Scanner result recorded on the box; boxes that passed no scanner count as normal. */
  private grade(box: Cargo): CargoGrade {
    return this.inspection.resultOf(box.node) === "fault" ? "defect" : "normal";
  }
  private assign(
    robot: FactoryRobot,
    pallet: PalletController,
    slot: number,
    box: Cargo,
  ) {
    if (!pallet.reserve(slot)) return;
    box.state = "reserved";
    this.cargo.reserveBox({ t: this.elapsed, robotId: robot.object.id, boxId: box.id });
    robot.busy = true;
    robot.status = "집기 준비";
    const job: Transfer = {
      box: box.node,
      pickup: box.node.position.clone(),
      destination: pallet.slots[slot].clone(),
      clearanceY: pallet.stackTop + PALLET_STACKING.clearance,
      moving: true,
      yaw: pallet.object.yaw,
      velocity: new Vector3(),
      available: () =>
        // A reserved box that stopped (stopper / queue) outside the reach never comes back: give it up.
        box.state === "reserved" && box.distance < beltLength(box.belt)
        && !(box.speed === 0 && distance(robot.object, box.node.position) > (this.settings()[robot.object.id]?.reach ?? SIMULATOR_CONFIG.reach)),
      onPick: () => {
        box.state = "held";
        if (this.feedBoxIds.delete(box.id)) this.feedScan.unscanned++;
        this.cargo.pickBox({ t: this.elapsed, robotId: robot.object.id, boxId: box.id });
      },
      onPlace: () => {
        box.state = "placed";
        box.pallet = pallet.object.id;
        pallet.place(slot, box.node, this.elapsed);
        this.cargo.placeBox({ t: this.elapsed, robotId: robot.object.id, boxId: box.id, stationId: pallet.object.id });
        this.placed++;
        robot.count++;
      },
      onMiss: () => {
        box.state = "moving";
        box.attempted.add(robot.object.id);
        this.cargo.missBox({ t: this.elapsed, robotId: robot.object.id, boxId: box.id, beltId: box.belt.id });
        pallet.release(slot);
        robot.busy = false;
      },
    };
    box.job = job;
    robot.jobs.push(job);
    this.move(box);
  }
  /** Unload docks: a depalletizing robot puts the delivered boxes (top first) one by one onto its nearest belt. */
  private readonly dropPointCache = new Map<string, { best: number; bestGap: number }>();
  private advanceDepalletizers(settings: Record<string, EquipmentSettings>, halted: Set<string>) {
    for (let i = this.unloadLoads.length - 1; i >= 0; i--) {
      const load = this.unloadLoads[i];
      if (load.boxes.length || load.top > 0) continue;
      // Empty pallet returned (removed) so the dock accepts the next delivery; kept ones ride back on their shuttle.
      if (!load.keep) {
        load.group.removeFromParent();
        this.unrender(load.group);
      }
      if (load.palletId) this.cargo.emptyPallet({ t: this.elapsed, palletId: load.palletId });
      this.emptiedPallets++;
      this.unloadLoads.splice(i, 1);
      load.onEmpty?.();
    }
    for (const robot of this.depalletizers) {
      const config = settings[robot.object.id];
      if (robot.busy || !config.enabled) continue;
      const reach = config.reach - ROBOT_PICKING.pickReachMargin;
      const load = this.unloadLoads
        .filter((l) => !l.deck && l.boxes.length && distance(robot.object, l.boxes[0].node.getWorldPosition(this.point)) <= reach)
        .sort((a, b) => distance(robot.object, a.dock) - distance(robot.object, b.dock))[0];
      if (!load) {
        robot.status = "하역 팔레트 대기";
        continue;
      }
      let target: { belt: SceneEquipment; d: number } | null = null;
      // Boxes received from an inbound pallet (hold flow or feed shuttle) must pass a scanner.
      const scan = !!load.scan || (!!load.boxes[0] && this.feedBoxIds.has(load.boxes[0].id));
      for (const { object: belt } of this.belts) {
        if (!settings[belt.id].enabled || halted.has(belt.id) || this.dropBooked.has(belt.id)) continue;
        const length = beltLength(belt);
        // Nearest drop point on this belt is static for a robot/belt pair; cached (was a 0.25 m scan every step).
        const key = `${robot.object.id}|${belt.id}|${robot.object.x},${robot.object.z}|${length}`;
        let nearest = this.dropPointCache.get(key);
        if (!nearest) {
          let best = -1, bestGap = Infinity;
          for (let d = BOX_SIZES[0].z; d <= length - BOX_SIZES[0].z; d += 0.25) {
            const p = beltPoint(belt, d), gap = Math.hypot(p.x - robot.object.x, p.z - robot.object.z);
            if (gap < bestGap) { bestGap = gap; best = d; }
          }
          this.dropPointCache.set(key, (nearest = { best, bestGap }));
        }
        const { best, bestGap } = nearest;
        if (best < 0 || bestGap > reach) continue;
        if (scan && !this.scanAfter(belt, best)) continue;
        if (!target || bestGap < distance(robot.object, beltPoint(target.belt, target.d))) target = { belt, d: best };
      }
      if (!target) {
        robot.status = "투입 컨베이어 대기";
        continue;
      }
      const { belt, d } = target;
      const clear = (distanceOn: number) => !this.boxes.some((b) =>
        (b.state === "moving" || b.state === "reserved") && b.belt.id === belt.id && Math.abs(b.distance - distanceOn) < BOX_SIZES[0].z + 0.1);
      if (!clear(d)) {
        robot.status = "투입 위치 대기";
        continue;
      }
      const box = load.boxes.shift()!;
      if (scan) {
        this.feedScan.dropped++;
        if (!this.scanAfter(belt, d)) this.feedScan.bypass++;
      }
      load.top++;
      this.dropBooked.add(belt.id);
      robot.busy = true;
      robot.status = "하역 준비";
      this.cargo.takeFromPallet({ t: this.elapsed, robotId: robot.object.id, boxId: box.id });
      const point = beltPoint(belt, d);
      const done = () => { this.dropBooked.delete(belt.id); load.top--; };
      robot.jobs.push({
        box: box.node,
        pickup: box.node.getWorldPosition(new Vector3()),
        destination: new Vector3(point.x, CONVEYOR_LAYOUT.height + BOX_SIZES[0].y, point.z),
        clearanceY: CONVEYOR_LAYOUT.height + BOX_SIZES[0].y + PALLET_STACKING.clearance,
        moving: false,
        yaw: point.yaw,
        velocity: new Vector3(),
        available: () => true,
        onPick: () => { box.state = "held"; },
        onPlace: () => {
          done();
          this.root.attach(box.node);
          box.node.position.set(point.x, CONVEYOR_LAYOUT.height + BOX_SIZES[0].y, point.z);
          box.node.rotation.set(0, point.yaw, 0);
          box.belt = belt;
          box.distance = d;
          box.state = "moving";
          box.pallet = undefined;
          box.attempted.clear();
          box.job = undefined;
          this.boxes.push(box);
          this.cargo.unloadBox({ t: this.elapsed, robotId: robot.object.id, boxId: box.id, beltId: belt.id });
          this.move(box);
          this.depalletized++;
          robot.count++;
        },
        onMiss: () => {
          // Left on the pallet; retried later.
          done();
          box.state = "placed";
          load.boxes.unshift(box);
          robot.busy = false;
        },
      });
    }
  }
  /** Transfer pose in front of an outbound belt start, where an AMR's top roller hands the pallet over. */
  private outboundPose(belt: SceneEquipment) {
    const start = beltPoint(belt, 0);
    return {
      x: start.x - Math.sin(start.yaw) * PALLET_CONVEYOR.transferOffset,
      y: 0,
      z: start.z - Math.cos(start.yaw) * PALLET_CONVEYOR.transferOffset,
      yaw: start.yaw,
    };
  }
  private outboundBusy(belt: SceneEquipment) {
    const on = this.rolling.filter((r) => r.belt.id === belt.id);
    return on.length >= PALLET_CONVEYOR.maxPallets || on.some((r) => r.distance < PALLET_CONVEYOR.palletGap);
  }
  /** Pallets roll off the AMR onto the outbound belt, queue with a gap and leave at its end (출하). */
  private advanceOutbound(dt: number, settings: Record<string, EquipmentSettings>) {
    const byBelt = new Map<string, RollingPallet[]>();
    for (const item of this.rolling) {
      const list = byBelt.get(item.belt.id) ?? [];
      list.push(item);
      byBelt.set(item.belt.id, list);
    }
    for (const list of byBelt.values()) {
      list.sort((a, b) => b.distance - a.distance);
      const belt = list[0].belt, length = beltLength(belt);
      const config = settings[belt.id];
      const speed = config?.enabled === false ? 0 : Math.min(PALLET_CONVEYOR.palletSpeed, beltSpeedOf(config));
      let limit = Infinity;
      for (const item of list) {
        // Rolling off the AMR runs at the transfer speed even when the belt is slow.
        const v = item.distance < 0 ? PALLET_CONVEYOR.transferOffset / PALLET_CONVEYOR.transferSeconds : speed;
        item.distance = Math.min(item.distance + v * dt, limit);
        limit = item.distance - PALLET_CONVEYOR.palletGap;
        const along = Math.min(Math.max(item.distance, -PALLET_CONVEYOR.transferOffset), length);
        const start = beltPoint(belt, 0), p = along < 0
          ? { x: start.x + Math.sin(start.yaw) * along, z: start.z + Math.cos(start.yaw) * along, yaw: start.yaw }
          : beltPoint(belt, along);
        const lift = Math.min(1, (item.distance + PALLET_CONVEYOR.transferOffset) / PALLET_CONVEYOR.transferOffset);
        item.group.position.set(p.x, item.fromY + (CONVEYOR_LAYOUT.height - item.fromY) * lift, p.z);
        item.group.rotation.set(0, p.yaw, 0);
      }
      const head = list[0];
      if (head.distance >= length - PALLET_CONVEYOR.dropBeforeEnd) {
        head.group.removeFromParent();
        this.unrender(head.group);
        for (const node of head.boxes) this.unrender(node);
        if (head.palletId) this.cargo.shipPallet({ t: this.elapsed, palletId: head.palletId, dockId: belt.id });
        this.outboundShipped++;
        this.rolling.splice(this.rolling.indexOf(head), 1);
      }
    }
  }
  robotProgress(robot: FactoryRobot, count: number, status: string) {
    robot.status = status;
    if (status.startsWith("RETREAT 완료")) {
      robot.completed = count;
      robot.busy = false;
    }
  }
  private ship(pallet: PalletController, agent: FactoryAgent) {
    const robot = this.loaderOf(pallet) ?? [...this.robots].sort(
      (a, b) =>
        distance(a.object, pallet.object) - distance(b.object, pallet.object),
    )[0];
    const fed = robot ? this.feedBelts.get(robot.object.id) : undefined;
    const belt = (fed ? this.belts.filter((b) => fed.has(b.object.id)) : [...this.belts]).sort(
      (a, b) =>
        distance(a.object, pallet.object) - distance(b.object, pallet.object),
    )[0];
    const settings = this.settings(),
      grade = palletGrade(settings[pallet.object.id]);
    // Docks and racks are both outbound destinations.
    // Linked destinations only when the station has deliver links; the nearest free one is used.
    const accepting = this.linkedOrAll([...this.docks, ...this.racks, ...this.unloadDocks, ...this.outboundBelts], this.links.outgoing(pallet.object.id, "deliver"), (d) => d.id).filter((dock) => {
      const config = settings[dock.id],
        accepts = config.acceptGrade ?? "any";
      // Depalletizing robots (적재) take any pallet: they feed unscanned boxes to the scanner line, no grade.
      return config.enabled && (accepts === "any" || accepts === grade);
    });
    if (!this.auto && !this.links.outgoing(pallet.object.id, "deliver").length) {
      agent.waitingReason = noLink("배송(팔레트 → 도착지)");
      this.warnOnce(agent.waitingReason, pallet.object.name);
      return false;
    }
    // One pallet per dock: skip docks booked by another delivery or still holding a drop.
    const docks = accepting
      .filter((dock) =>
        dock.kind === "rack"
          ? this.freeSlot(dock) >= 0 && (!this.forkliftAgents.length || !this.handoffBusy(dock))
          : !this.shipments.some((s) => s.dock.id === dock.id) &&
            // Strictly one AMR per dock: the previous one must have fully left its footprint.
            !this.agents.some((a) => a !== agent && distance(a.dispatch.carrier.position, dock) < a.dispatch.radius * 2 + 0.5) &&
            !(dock.kind === "conveyor" && this.outboundBusy(dock)) &&
            !this.unloadLoads.some((l) => l.dock.id === dock.id),
      )
      .sort((a, b) => distance(a, pallet.object) - distance(b, pallet.object));
    if (robot && belt && accepting.length && !docks.length) {
      agent.waitingReason = accepting.every((dock) => dock.kind === "rack")
        ? "랙이 가득 찼습니다."
        : "출고 구역에 내려놓은 팔레트를 비우는 중입니다.";
      return false;
    }
    if (!robot || !belt || !docks.length) {
      agent.waitingReason =
        robot && belt && this.docks.length + this.racks.length
          ? `${grade === "defect" ? "불량품" : "정상품"} 적재 팔레트를 받을 출고 구역이 없습니다.`
          : "운반할 로봇·컨베이어·출고 구역을 확인해 주세요.";
      return false;
    }
    // AMRs never lift a floor pallet: a forklift brings it onto the AMR's deck where the AMR waits.
    const forklift = this.idleForklift(pallet);
    if (!forklift) {
      agent.waitingReason = this.forkliftAgents.length ? "지게차 대기 · 팔레트를 AMR에 올려줄 지게차가 없습니다." : FORKLIFT_MISSING;
      if (!this.forkliftAgents.length) this.warnOnce(FORKLIFT_MISSING, pallet.object.name);
      return false;
    }
    const layout: FactoryLayout = {
      robot: robot.object,
      conveyor: belt.object,
      pallet: pallet.object,
      amr: {
        x: agent.dispatch.carrier.position.x,
        z: agent.dispatch.carrier.position.z,
        yaw: 0,
      },
      dock: docks[0],
    };
    const obstacles: NavigationObstacle[] = [
      ...this.wallObstacles,
      ...this.robots
        .filter((r) => r !== robot)
        .map((r) => ({ kind: r.object.kind, pose: r.object })),
      ...this.belts
        .filter((b) => b !== belt)
        .map((b) => ({ kind: b.object.kind, pose: b.object })),
      ...this.pallets
        .filter((p) => p !== pallet && !p.shipping)
        .map((p) => ({ kind: p.object.kind, pose: p.object })),
      ...this.racks.map((r) => ({ kind: r.kind, pose: r })),
      ...this.outboundBelts.map((b) => ({ kind: b.kind, pose: b })),
    ];
    const approach = layoutPath(layout, layout.amr, layout.pallet, false, obstacles);
    if (!approach) {
      agent.waitingReason ??= routeFailureReason(layout, layout.amr, layout.pallet, false, obstacles, `${pallet.object.name} 픽업`);
      return false;
    }
    // Hand-off pose: the AMR stops short of the station on its approach (it never drives under the floor
    // pallet) and waits there, deck up, for the forklift.
    const pickup = trimPath(approach, FORKLIFT_HANDOFF_GAP);
    const handoffAt = pickup[pickup.length - 1].clone();
    const handoffPose = { x: handoffAt.x, z: handoffAt.z, yaw: 0 };
    let routes: DispatchRoutes | null = null;
    let target: SceneEquipment | null = null,
      targetSlot: number | undefined;
    for (const destination of docks) {
      // A rack is reached at the floor point in front of its first free slot.
      const slot = destination.kind === "rack" ? this.freeSlot(destination) : undefined;
      // With forklifts the AMR only brings the pallet to the rack's floor hand-off point.
      const handoff = slot !== undefined && this.forkliftAgents.length > 0;
      const approach = slot === undefined ? null : handoff ? this.handoffPoint(destination) : rackApproachPoint(destination, slot);
      const dock = destination.kind === "conveyor"
        ? { ...destination, ...this.outboundPose(destination) }
        : approach
          ? { ...destination, x: approach.x, z: approach.z }
          : destination;
      layout.dock = dock;
      const outbound = layoutPath(layout, handoffPose, dock, true, obstacles);
      if (!outbound) {
        agent.waitingReason ??= routeFailureReason(
          layout,
          handoffPose,
          dock,
          true,
          obstacles,
          `${dock.name} 출고`,
        );
        continue;
      }
      const returnObstacles: NavigationObstacle[] = [
        ...obstacles,
        { kind: "pallet", pose: pallet.object },
      ];
      const returning = layoutPath(
        layout,
        dock,
        agent.dispatch.home,
        false,
        returnObstacles,
      );
      if (!returning) {
        agent.waitingReason ??= routeFailureReason(
          layout,
          dock,
          agent.dispatch.home,
          false,
          returnObstacles,
          "대기 위치 복귀",
        );
        continue;
      }
      routes = { pickup, dispatch: outbound, returning, feed: { heading: axisHeading(pathHeading(pickup)) } };
      if (slot !== undefined && !handoff)
        routes.store = {
          slot: rackSlotPoint(destination, slot),
          // Face into the rack: its loading face looks along local +X.
          heading: rackHeading(destination),
        };
      layout.dock = dock;
      target = destination;
      targetSlot = slot;
      break;
    }
    if (!routes || !target) return false;
    let handed: Group | null = null;
    const deck = new Vector3(handoffAt.x, AMR_DECK, handoffAt.z);
    const receiveHeading = routes.feed?.heading;
    const job: ForkliftJob = {
      kind: "store",
      peerId: agent.object.id,
      ready: () => agent.dispatch.phase === "receiving",
      pickup: { point: new Vector3(pallet.object.x, 0, pallet.object.z), heading: pallet.object.yaw },
      take: () => handed,
      // Parallel to the AMR first (forks along its body), sideways only when those approaches are unreachable.
      targets: () => this.aroundTargets(deck, agent.object.id, receiveHeading),
      store: (payload) => {
        this.root.attach(payload);
        payload.position.copy(deck);
        agent.dispatch.received();
        this.forkliftHandoffs++;
        log("info", `팔레트 ${pallet.object.name} 지게차 → AMR 인계`, agent.object.name);
      },
    };
    if (!forklift.controller.start(job)) {
      agent.waitingReason = `${pallet.object.name}: 지게차가 팔레트로 갈 경로가 없습니다.`;
      return false;
    }
    const group = pallet.beginShipment();
    if (!group) return false;
    handed = group;
    // The outgoing pallet is cargo from now on: it is selected and tracked by its own pallet id,
    // not the station's (the station gets a new pallet group with the station id).
    delete group.userData.sceneId;
    group.userData.cargo = true;
    group.userData.boxId = this.cargo.currentPallet(pallet.object.id)?.id;
    const shipment: Shipment = {
      pallet,
      agent,
      group,
      cargo: new Set(
        this.boxes.filter(
          (box) => box.pallet === pallet.object.id && box.state === "placed",
        ),
      ),
      replaced: false,
      dock: target,
      dropped: false,
      slot: targetSlot,
      handoff: targetSlot !== undefined && this.forkliftAgents.length > 0,
      palletId: this.cargo.currentPallet(pallet.object.id)?.id,
    };
    this.shipments.push(shipment);
    const task = this.transport.queued().find((entry) => entry.stationId === pallet.object.id);
    if (task) this.transport.assign({ t: this.elapsed, taskId: task.id, agentId: agent.object.id, destinationId: target.id });
    if (shipment.palletId)
      this.cargo.dispatchPallet({ t: this.elapsed, palletId: shipment.palletId, amrId: agent.object.id, destinationId: target.id });
    agent.waiting = false;
    agent.waitingReason = null;
    agent.target = pallet.object.name;
    for (const box of shipment.cargo) box.state = "departing";
    agent.dispatch.configure(layout, obstacles);
    this.navigation.set(agent.object.id, { layout, obstacles });
    // Unload dock: the pallet stays on the AMR while the dock robot depalletizes it.
    if (routes && this.unloadDocks.includes(target)) routes.hold = this.holdOnDeck(shipment.group, agent);
    agent.dispatch.request(
      shipment.group,
      () => {
        // Release the lowered pallet onto the dock, square to it; removed once the AMR clears.
        // In a rack it is placed exactly on its PalletPoint and stays.
        const group = shipment.group,
          dock = shipment.dock;
        const onDeck = routes?.hold ? group.parent : null;
        group.parent?.updateWorldMatrix(true, false);
        this.root.updateWorldMatrix(true, false);
        this.root.attach(group);
        if (dock.kind === "conveyor") {
          // AMR top roller -> outbound belt (rolls on in advanceOutbound).
          const pose = this.outboundPose(dock);
          group.position.set(pose.x, group.position.y, pose.z);
          group.rotation.set(0, pose.yaw, 0);
          this.rolling.push({ belt: dock, group, boxes: [...shipment.cargo].map((b) => b.node), distance: -PALLET_CONVEYOR.transferOffset, fromY: group.position.y, palletId: shipment.palletId });
          shipment.stored = true;
          log("info", `팔레트 ${shipment.palletId ?? "-"} ${dock.name} 출하 컨베이어로 이송`, agent.object.name);
        } else if (this.unloadDocks.includes(dock) && onDeck) {
          // Stays on the AMR deck (re-parented back): the dock robot depalletizes it there.
          onDeck.attach(group);
          const boxes = [...shipment.cargo].sort((a, b) => b.node.getWorldPosition(new Vector3()).y - a.node.getWorldPosition(this.point).y);
          for (const box of boxes) box.state = "placed";
          this.unloadLoads.push({ dock, group, boxes, palletId: shipment.palletId, top: 0, keep: true });
          if (shipment.palletId) this.cargo.arrivePallet({ t: this.elapsed, palletId: shipment.palletId, dockId: dock.id });
          shipment.stored = true;
        } else if (this.unloadDocks.includes(dock)) {
          group.position.y = 0;
          group.rotation.set(0, dock.yaw, 0);
          const boxes = [...shipment.cargo].sort((a, b) => b.node.getWorldPosition(new Vector3()).y - a.node.getWorldPosition(this.point).y);
          for (const box of boxes) box.state = "placed";
          this.unloadLoads.push({ dock, group, boxes, palletId: shipment.palletId, top: 0 });
          if (shipment.palletId) this.cargo.arrivePallet({ t: this.elapsed, palletId: shipment.palletId, dockId: dock.id });
          shipment.stored = true;
        } else if (shipment.handoff && shipment.slot !== undefined) {
          group.position.y = 0;
          const key = `${dock.id}:${shipment.slot}`;
          this.slotBookings.add(key);
          this.handoffs.push({
            rack: dock,
            slot: shipment.slot,
            group,
            boxes: [...shipment.cargo].map((box) => box.node),
            palletId: shipment.palletId,
            claimed: false,
          });
          this.handedOff++;
          shipment.stored = true;
          log("info", `팔레트 ${shipment.palletId ?? "-"} ${dock.name} 인계 지점에 내려놓음 · 지게차 적재 대기`, agent.object.name);
        } else if (shipment.slot !== undefined) {
          group.position.copy(rackSlotPoint(dock, shipment.slot));
          this.rackStored.get(dock.id)![shipment.slot] = true;
          // Stored for the rest of the run: its instances (pallet + boxes) skip per-frame updates.
          group.userData.instanceStatic = true;
          shipment.stored = true;
          if (shipment.palletId) {
            this.cargo.storePallet({ t: this.elapsed, palletId: shipment.palletId, rackId: dock.id, slot: shipment.slot });
            const record = this.cargo.pallet(shipment.palletId);
            const slots = this.rackPallets.get(dock.id);
            if (record && slots) slots[shipment.slot] = { id: record.id, grade: record.grade, boxes: record.boxIds.length, storedAt: this.elapsed };
          }
          const groups = this.rackGroups.get(dock.id);
          if (groups) groups[shipment.slot] = { group, boxes: [...shipment.cargo].map((box) => box.node) };
        } else {
          group.position.y = 0;
          if (shipment.palletId)
            this.cargo.dropPallet({ t: this.elapsed, palletId: shipment.palletId, dockId: dock.id });
        }
        // Read yaw in YXZ so headings past ±90° don't decompose into X/Z flips.
        const yaw = new Euler().setFromQuaternion(group.quaternion, "YXZ").y;
        if (dock.kind !== "conveyor" && group.parent === this.root) group.rotation.set(
          0,
          dock.yaw + (Math.PI / 2) * Math.round((yaw - dock.yaw) / (Math.PI / 2)),
          0,
        );
        shipment.dropped = shipment.slot === undefined && !shipment.stored;
        this.transport.complete({ t: this.elapsed, stationId: shipment.pallet.object.id, agentId: agent.object.id });
        this.dispatched++;
        agent.completed++;
        agent.target = null;
      },
      routes,
    );
    return true;
  }
  /** Unload dock hold: the AMR waits with the pallet on its deck until the dock robot has emptied it, then drives the
   * empty pallet back; there it waits until a forklift lifts it off (AMR setting emptyPallet, default "forklift"). */
  private holdOnDeck(group: Group, agent: FactoryAgent) {
    return {
      busy: () => this.unloadLoads.some((l) => l.group === group),
      emptyHome: (pallet: Group, taken: () => void) => this.emptyPicks.push({ agent, pallet, taken, started: false }),
    };
  }
  /** Emptied pallets waiting on an AMR deck for a forklift (FIFO: deterministic). */
  private emptyPicks: { agent: FactoryAgent; pallet: Group; taken: () => void; started: boolean }[] = [];
  emptyPicked = 0;
  /** Drop point on the nearest empty-pallet stack (pallet cycle source first, else a simulator stack). */
  private emptyDrop(at: Vector3, linked: readonly string[] = []): { point: Vector3; id: string } | null {
    const cycle = this.cycle?.emptyStackDrop(at, linked);
    if (cycle) return cycle;
    const gap = (s: { dock: SceneEquipment }) => Math.hypot(s.dock.x - at.x, s.dock.z - at.z);
    const docks = this.emptyStacks.filter((s) => !s.dock.id.startsWith(FLOOR_STACK));
    const linkedStacks = docks.filter((s) => linked.includes(s.dock.id));
    const stack = (linkedStacks.length ? linkedStacks : docks).reduce<(typeof this.emptyStacks)[number] | null>((best, s) => (!best || gap(s) < gap(best) ? s : best), null);
    if (!stack) return null;
    const level = Math.min(stack.pallets.length, stackCapacityOf(this.settings()[stack.dock.id]) - 1);
    return { point: new Vector3(stack.dock.x, level * STREAM_CONFIG.palletHeight, stack.dock.z), id: stack.dock.id };
  }
  /** No empty-pallet stack in the layout: the forklift stacks empties on the floor next to its home (first clear spot it
   * can reach loaded), created once per forklift and kept for the run. */
  private floorStack(forklift: FactoryForkliftAgent): { point: Vector3; id: string } | null {
    const id = `${FLOOR_STACK}${forklift.object.id}`;
    let stack = this.emptyStacks.find((s) => s.dock.id === id);
    if (!stack) {
      const home = forklift.controller.home;
      const clear = (x: number, z: number) =>
        this.layoutObjects.every((o) => o.kind === "floor" || o.kind === "amr" || o.kind === "pallet" || Math.hypot(o.x - x, o.z - z) > 2.5);
      search: for (const r of [3, 4.5, 6])
        for (let i = 0; i < 8; i++) {
          const a = forklift.object.yaw + Math.PI + (i * Math.PI) / 4;
          const point = new Vector3(home.x + Math.sin(a) * r, 0, home.z + Math.cos(a) * r);
          if (!clear(point.x, point.z) || !this.forkliftRoute(home, point, true)) continue;
          const dock: SceneEquipment = { id, kind: "dock", name: `${forklift.object.name} 빈 팔레트 적치(바닥)`, x: point.x, z: point.z, yaw: forklift.object.yaw };
          stack = { dock, pallets: [] };
          this.emptyStacks.push(stack);
          log("info", `빈 팔레트 적치장 없음 · ${forklift.object.name} 옆 바닥에 쌓습니다`, `(${point.x.toFixed(1)}, ${point.z.toFixed(1)})`);
          break search;
        }
      if (!stack) return null;
    }
    const level = Math.min(stack.pallets.length, stackCapacityOf(this.settings()[id]) - 1);
    return { point: new Vector3(stack.dock.x, level * STREAM_CONFIG.palletHeight, stack.dock.z), id };
  }
  /** Forklift job "takeEmptyFromAmr": emptied pallet off a waiting AMR's deck onto the empty-pallet stack; the AMR is then free
   * (empty) for the next inbound pallet. Without a forklift the AMR keeps waiting (warning once); nothing moves by itself. */
  private advanceEmptyPicks(settings: Record<string, EquipmentSettings>) {
    for (const pick of [...this.emptyPicks]) {
      if (pick.started) continue;
      const { agent, pallet } = pick;
      const at = pallet.getWorldPosition(new Vector3());
      // Link decides (🔗 빈 팔레트 회수: AMR → forklift / stack), else the nearest one.
      const linked = this.links.outgoing(agent.object.id, "emptyReturn");
      if (!linked.length && !this.auto) {
        agent.waitingReason = noLink("빈 팔레트 반납");
        this.warnOnce(agent.waitingReason, agent.object.name);
        continue;
      }
      const linkedForklifts = this.forkliftAgents.filter((f) => linked.includes(f.object.id));
      const able = (linkedForklifts.length ? linkedForklifts : this.forkliftAgents).filter((f) => settings[f.object.id]?.enabled && takesEmptyPallets(settings[f.object.id]));
      if (!able.length) {
        agent.waitingReason = EMPTY_PICK_NO_FORKLIFT;
        this.warnOnce(EMPTY_PICK_NO_FORKLIFT, agent.object.name);
        continue;
      }
      // Nearest by forklift route (dedicated emptyReturn forklifts first); a busy nearest one is waited for instead of
      // sending a far idle forklift across the floor.
      const reach = (f: (typeof able)[number]) => {
        const path = this.forkliftRoute(f.controller.carrier.position, at, false);
        return (!doesGeneralJobs(settings[f.object.id]) ? 0 : 1e6) + Math.min(path ? pathLength(path) : Infinity, 1e5) + distance(f.controller.carrier.position, at) * 1e-3;
      };
      const nearest = able.reduce((best, f) => (reach(f) < reach(best) ? f : best));
      const forklift = nearest.controller.idle ? nearest : null;
      if (!forklift) {
        agent.waitingReason = EMPTY_PICK_WAIT;
        continue;
      }
      // Stack: AMR link / the forklift's own 🔗 palletSource, else the nearest stack, else the forklift's floor stack.
      const dropLinks = [...linked, ...this.links.outgoing(forklift.object.id, "emptyReturn")];
      const dropFor = () => this.emptyDrop(at, dropLinks) ?? this.floorStack(forklift);
      const drop = dropFor();
      if (!drop) {
        agent.waitingReason = EMPTY_PICK_NO_STACK;
        this.warnOnce(EMPTY_PICK_NO_STACK, agent.object.name);
        continue;
      }
      let released = false;
      const job: ForkliftJob = {
        kind: "takeEmptyFromAmr",
        peerId: agent.object.id,
        pickup: { point: at, heading: agent.dispatch.carrier.rotation.y },
        take: () => pallet,
        // First target choice happens with the pallet lifted and the forks backed out: the AMR is free (empty) from here.
        targets: () => {
          if (!released) {
            released = true;
            this.emptyPicks.splice(this.emptyPicks.indexOf(pick), 1);
            pick.taken();
            agent.waitingReason = null;
          }
          const now = dropFor() ?? drop;
          return this.aroundTargets(now.point, now.id);
        },
        store: (payload) => {
          this.emptyPicked++;
          this.recycleEmpty(payload);
          log("info", `빈 팔레트 ${agent.object.name} → 적치장`, forklift.object.name);
        },
      };
      if (!forklift.controller.start(job)) {
        agent.waitingReason = `${agent.object.name}: 지게차가 빈 팔레트로 갈 경로가 없습니다.`;
        continue;
      }
      pick.started = true;
      agent.waitingReason = "지게차가 빈 팔레트를 내리는 중";
      log("info", `${agent.object.name}: 빈 팔레트 회수 지게차 배정`, forklift.object.name);
    }
  }
  /** Warnings raised once per cause (not every tick). */
  private readonly warned = new Set<string>();
  get warnedMessages(): ReadonlySet<string> {
    return this.warned;
  }
  get floorLiftAttempts() {
    return PalletDispatchController.floorLiftAttempts;
  }
  /** Pallets handed forklift -> AMR deck, and pallets carried by forklift to an outbound robot. */
  forkliftHandoffs = 0;
  forkliftOutbound = 0;
  private warnOnce(message: string, source?: string) {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    log("warning", message, source);
  }
  private idleForklift(near: { object: { x: number; z: number } }) {
    const settings = this.settings();
    return this.forkliftAgents
      .filter((f) => settings[f.object.id]?.enabled && f.controller.idle && doesGeneralJobs(settings[f.object.id]))
      .sort((a, b) => distance(a.controller.carrier.position, near.object) - distance(b.controller.carrier.position, near.object))[0];
  }
  /** Forklift drop poses around `point`: the pallet lands on `point` (height y) approached from four sides. */
  private aroundTargets(point: Vector3, id: string, prefer?: number): ForkliftTarget[] {
    const headings = prefer === undefined ? [0, Math.PI / 2, Math.PI, -Math.PI / 2] : [prefer, prefer + Math.PI, prefer + Math.PI / 2, prefer - Math.PI / 2];
    return headings.map((heading, slot) => ({
      rackId: id,
      slot,
      slotPoint: point.clone(),
      heading,
      // With a preferred axis both parallel sides (heading and +180deg) are equivalent: the cheaper one wins.
      group: prefer === undefined ? undefined : slot < 2 ? 0 : 1,
      approach: forkliftStop(point, heading, FORKLIFT_CONFIG.forkLength),
    }));
  }
  /** Drop poses in front of a robot (within its reach), pallet facing it. */
  private robotTargets(robot: FactoryRobot, reach: number): ForkliftTarget[] {
    const d = Math.min(1.6, Math.max(1.0, reach - 0.7));
    const out: ForkliftTarget[] = [];
    for (let i = 0; i < 8; i++) {
      const a = robot.object.yaw + (i * Math.PI) / 4;
      const point = new Vector3(robot.object.x + Math.sin(a) * d, 0, robot.object.z + Math.cos(a) * d);
      const heading = a + Math.PI;
      out.push({ rackId: robot.object.id, slot: i, slotPoint: point, heading, approach: forkliftStop(point, heading, FORKLIFT_CONFIG.forkLength) });
    }
    return out;
  }
  /** No AMR: the forklift brings the full pallet to an outbound robot, holds it while the boxes are unloaded, then
   * takes the empty pallet away. */
  private forkliftShip(pallet: PalletController, settings: Record<string, EquipmentSettings>) {
    // A linked depalletizer if any (the deliver link usually names its unload dock, not the robot), else the nearest.
    const enabled = this.depalletizers.filter((r) => settings[r.object.id]?.enabled);
    const linked = this.linkedOrAll(enabled, this.links.outgoing(pallet.object.id, "deliver"), (r) => r.object.id);
    const robots = (linked.length || !this.auto ? linked : enabled)
      .sort((a, b) => distance(a.object, pallet.object) - distance(b.object, pallet.object));
    if (!robots.length) {
      this.warnOnce(NO_FLOW, pallet.object.name);
      return false;
    }
    if (!this.forkliftAgents.length) {
      this.warnOnce(FORKLIFT_MISSING, pallet.object.name);
      return false;
    }
    const forklift = this.idleForklift(pallet);
    if (!forklift) return false;
    const robot = robots[0];
    const reach = settings[robot.object.id].reach - ROBOT_PICKING.pickReachMargin;
    let group: Group | null = null;
    const boxes = this.boxes.filter((b) => b.pallet === pallet.object.id && b.state === "placed");
    const palletId = this.cargo.currentPallet(pallet.object.id)?.id;
    const job: ForkliftJob = {
      kind: "store",
      pickup: { point: new Vector3(pallet.object.x, 0, pallet.object.z), heading: pallet.object.yaw },
      take: () => {
        if (!group) return null;
        const taken = group;
        // Station gets a fresh pallet as soon as the full one is on the forks.
        this.fullReported.delete(pallet);
        this.reuseEmpty();
        this.root.add(pallet.replace());
        this.render(pallet.group);
        this.startPalletRecord(pallet);
        return taken;
      },
      targets: () => this.robotTargets(robot, reach),
      store: (payload) => {
        const sorted = [...boxes].sort((a, b) => b.node.getWorldPosition(new Vector3()).y - a.node.getWorldPosition(this.point).y);
        for (const box of sorted) box.pallet = undefined;
        this.unloadLoads.push({ dock: pallet.object, group: payload, boxes: sorted, palletId, top: 0, keep: true });
        log("info", `팔레트 ${palletId ?? "-"} 지게차 → ${robot.object.name} 하역`, forklift.object.name);
      },
      hold: () => this.unloadLoads.some((l) => l.group === group),
      release: (payload) => {
        payload.removeFromParent();
        this.unrender(payload);
        this.forkliftOutbound++;
        log("info", `빈 팔레트 회수`, forklift.object.name);
      },
    };
    if (!forklift.controller.start(job)) {
      forklift.waitingReason = `${pallet.object.name}: 팔레트로 가는 경로가 없습니다.`;
      return false;
    }
    group = pallet.beginShipment();
    if (!group) return false;
    delete group.userData.sceneId;
    group.userData.cargo = true;
    return true;
  }
  /** A racked pallet keeps rendering with its boxes; it only leaves the live box list. */
  private finishStorage(shipment: Shipment) {
    this.boxes = this.boxes.filter((box) => !shipment.cargo.has(box));
    this.replacePallet(shipment);
    this.shipments.splice(this.shipments.indexOf(shipment), 1);
  }
  private clearDock(shipment: Shipment) {
    if (shipment.palletId)
      this.cargo.shipPallet({ t: this.elapsed, palletId: shipment.palletId, dockId: shipment.dock.id });
    this.unrender(shipment.group);
    for (const box of shipment.cargo) this.unrender(box.node);
    shipment.group.removeFromParent();
    shipment.group.clear();
    this.boxes = this.boxes.filter((box) => !shipment.cargo.has(box));
    this.replacePallet(shipment);
    this.shipments.splice(this.shipments.indexOf(shipment), 1);
  }
  private replacePallet(shipment: Shipment) {
    if (shipment.replaced) return;
    shipment.replaced = true;
    const pallet = shipment.pallet;
    this.fullReported.delete(pallet);
    this.reuseEmpty();
    this.root.add(pallet.replace());
    this.render(pallet.group);
    this.startPalletRecord(pallet);
  }
  /** Forklift floor route around fixed equipment (other AMRs are not considered). */
  private forkliftRoute(from: Vector3, to: Vector3, loaded: boolean, extra: NavigationObstacle[] = []) {
    // layoutPath is a pure function of its inputs and rackLayout / rackObstacles are fixed for the run, so a route
    // with exactly the same start, goal, load and extra obstacles is the same route. Held forklifts retry the same
    // (often unreachable, whole-grid) search every second while nothing around them moves; those become lookups.
    let key = `${from.x},${from.z}>${to.x},${to.z}:${loaded ? 1 : 0}`;
    for (const o of extra) {
      key += `|${o.kind},${o.pose.x},${o.pose.z},${o.pose.yaw},${o.radius ?? ""}`;
      if (o.path) for (const p of o.path) key += `;${p.x},${p.z}`;
    }
    let path = this.routeCache.get(key);
    if (path === undefined) {
      path = layoutPath(this.rackLayout, from, to, loaded, extra.length ? [...this.rackObstacles, ...extra] : this.rackObstacles);
      if (this.routeCache.size >= ROUTE_CACHE_SIZE) this.routeCache.delete(this.routeCache.keys().next().value!);
      this.routeCache.set(key, path);
    }
    // Callers own (and may advance through) the returned points.
    return path && path.map((point) => point.clone());
  }
  /** Exact-input forklift route results (null = no route); oldest dropped first. */
  private routeCache = new Map<string, Vector3[] | null>();
  /** Forklift traffic: wait seconds per forklift while held, and the next detour attempt. */
  private forkliftTraffic = new Map<string, { wait: number; retry: number }>();
  private forkliftAhead = new Vector3();
  private forkliftNext = new Vector3();
  private guardPose = new Vector3();
  /**
   * AMR rack insert / retreat guard: the next creep point may not close in below the safety gap on another AMR or a
   * forklift circle (moves that open the gap always pass). Broadphase: axis box of FORKLIFT_TRAFFIC.guardRange.
   */
  private amrGuard(agent: FactoryAgent) {
    return (x: number, z: number) => {
      const self = agent.dispatch,
        here = self.carrier.position,
        range = FORKLIFT_TRAFFIC.guardRange;
      const ok = (at: Vector3, radius: number) => {
        if (Math.abs(at.x - here.x) > range || Math.abs(at.z - here.z) > range) return true;
        const limit = self.radius + radius + AMR_TRAFFIC.safetyMargin,
          then = Math.hypot(at.x - x, at.z - z);
        return then >= limit || then >= Math.hypot(at.x - here.x, at.z - here.z) - 1e-6;
      };
      for (const other of this.agents) if (other !== agent && !ok(other.dispatch.carrier.position, other.dispatch.radius)) return false;
      for (const body of this.trafficBodies) if (!ok(body.position, body.radius)) return false;
      return true;
    };
  }
  /**
   * Forklift guard for in-place turns and fork in / out creeps (incl. recover / back-outs): the swept capsule at the
   * next pose (position + heading) may not close in below the safety gap on any AMR (except the job's deck peer) or
   * another forklift circle. Broadphase: axis box of FORKLIFT_TRAFFIC.guardRange.
   */
  private forkliftGuard(agent: FactoryForkliftAgent) {
    return (x: number, z: number, heading: number) => {
      const controller = agent.controller,
        here = controller.carrier.position,
        range = FORKLIFT_TRAFFIC.guardRange,
        pose = this.guardPose.set(x, 0, z);
      const ok = (at: Vector3, radius: number) => {
        if (Math.abs(at.x - here.x) > range || Math.abs(at.z - here.z) > range) return true;
        const then = controller.clearance(at.x, at.z, pose, heading);
        return then >= radius + AMR_TRAFFIC.safetyMargin || then >= controller.clearance(at.x, at.z) - 1e-6;
      };
      for (const other of this.agents) if (other.object.id !== controller.job?.peerId && !ok(other.dispatch.carrier.position, other.dispatch.radius)) return false;
      for (const other of this.forkliftAgents) if (other !== agent) for (const at of other.controller.bodies) if (!ok(at, other.controller.radius)) return false;
      return true;
    };
  }
  /** Forklift footprint circles of the current step (AMR traffic planner and forklift make-way). */
  private trafficBodies: TrafficBody[] = [];
  /** AMR traffic replanner (stall / detour / side step / evade): axis-aligned route around the other AMRs and forklifts. */
  private readonly trafficPlan: TrafficPlanner = (vehicle, target, inflate = 0, ignore) => {
    const navigation = this.navigation.get(vehicle.id);
    if (!navigation) return null;
    const dispatch = vehicle.dispatch,
      goal = target ?? dispatch.goal;
    if (!goal) return null;
    const position = dispatch.carrier.position,
      own = dispatch.radius;
    // Other AMRs are temporary obstacles. Shrink a disc that already touches this
    // vehicle so the start is never "occupied", and ignore one parked on the goal:
    // traffic control then waits behind it instead of failing the route.
    const obstacles: NavigationObstacle[] = [...navigation.obstacles];
    for (const other of this.agents) {
      if (other.object.id === vehicle.id || other.object.id === ignore) continue;
      const at = other.dispatch.carrier.position,
        radius = Math.max(
          0,
          Math.min(
            other.dispatch.radius + AMR_TRAFFIC.safetyMargin + inflate,
            Math.hypot(at.x - position.x, at.z - position.z) - own - 1e-3,
          ),
        );
      if (
        !target &&
        Math.hypot(at.x - goal.x, at.z - goal.z) < radius + dispatch.radiusAt(goal)
      )
        continue;
      obstacles.push({
        kind: other.object.kind,
        pose: { x: at.x, z: at.z, yaw: 0 },
        radius,
      });
    }
    // Forklifts are moving obstacles too (shrunk like the AMRs above when already touching).
    for (const body of this.trafficBodies) {
      if (ignore !== undefined && body.owner === ignore) continue;
      const at = body.position,
        radius = Math.max(0, Math.min(body.radius + AMR_TRAFFIC.safetyMargin + inflate, Math.hypot(at.x - position.x, at.z - position.z) - own - 1e-3));
      if (!target && Math.hypot(at.x - goal.x, at.z - goal.z) < radius + dispatch.radiusAt(goal)) continue;
      obstacles.push({ kind: "amr", pose: { x: at.x, z: at.z, yaw: 0 }, radius });
    }
    if (dispatch.phase === "returning")
      obstacles.push({ kind: "pallet", pose: navigation.layout.pallet });
    // A failed search explores the whole region (~50 ms); retrying the same trip every step stalled frames.
    // Remember the failure briefly (same start/goal within a few cm) and report "no path" without searching.
    const failed = this.failedRoutes.get(vehicle.id), p0 = dispatch.carrier.position;
    // Coarse signature of the moving obstacles (0.5 m grid): when a blocker leaves, the cached failure is stale.
    let sig = "";
    for (let i = navigation.obstacles.length; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.kind !== "pallet") sig += `${Math.round(o.pose.x * 2)},${Math.round(o.pose.z * 2)};`;
    }
    const repeat = failed && failed.sig === sig && this.trafficTick - failed.tick < ROUTE_FAIL_HOLD_STEPS && failed.loaded === dispatch.loaded
      && Math.hypot(failed.sx - p0.x, failed.sz - p0.z) < 0.05 && Math.hypot(failed.gx - goal.x, failed.gz - goal.z) < 0.05;
    const direct = repeat ? null : layoutPath(navigation.layout, p0, goal, dispatch.loaded, obstacles, AXIS_ROUTE);
    if (direct) this.failedRoutes.delete(vehicle.id);
    if (!direct && !repeat) this.failedRoutes.set(vehicle.id, { tick: this.trafficTick, loaded: dispatch.loaded, sig, sx: p0.x, sz: p0.z, gx: goal.x, gz: goal.z });
    // Inbound-conveyor receive pose sits inside the belt clearance: route via its straight approach lane.
    const lane = dispatch.feedLane;
    if (direct || !lane) return direct;
    const here = dispatch.carrier.position.clone();
    if (Math.hypot(goal.x - lane.x, goal.z - lane.z) < 1.6) {
      const path = layoutPath(navigation.layout, here, lane, dispatch.loaded, obstacles, AXIS_ROUTE);
      return path && [...path, new Vector3(goal.x, 0, goal.z)];
    }
    if (here.distanceTo(lane) < 1.6) {
      const path = layoutPath(navigation.layout, lane, goal, dispatch.loaded, obstacles, AXIS_ROUTE);
      return path && [here, ...path];
    }
    return null;
  };
  /**
   * Holds a driving forklift short of any other AMR body (regular or rack) it would close in on; after
   * waiting a while it plans a detour around them. Regular AMRs treat forklifts as bodies to keep clear of.
   */
  private holdForklift(agent: FactoryForkliftAgent, step: number, dt: number, settings: Record<string, EquipmentSettings>) {
    const controller = agent.controller,
      position = controller.carrier.position;
    const state = this.forkliftTraffic.get(agent.object.id) ?? { wait: 0, retry: 0 };
    this.forkliftTraffic.set(agent.object.id, state);
    controller.held = false;
    // A turn / fork creep held by the move guard counts as blocked too (make-way / joint plan below).
    const guarded = !controller.moving && controller.guardHeld;
    if (!controller.moving && !guarded) {
      state.wait = 0;
      return;
    }
    // The job's peer AMR (deck hand-off) is only ignored on the final approach; elsewhere it is traffic like any other.
    const end = controller.goal,
      nearPeer = end !== null && Math.hypot(end.x - position.x, end.z - position.z) < FORKLIFT_TRAFFIC.peerIgnoreRange;
    const others: { at: Vector3; radius: number }[] = [];
    for (const other of this.agents)
      if (settings[other.object.id].enabled && (other.object.id !== controller.job?.peerId || !nearPeer)) others.push({ at: other.dispatch.carrier.position, radius: other.dispatch.radius });
    for (const other of this.forkliftAgents)
      if (other !== agent && settings[other.object.id].enabled) for (const at of other.controller.bodies) others.push({ at: at.clone(), radius: other.controller.radius });
    // Footprint (capsule) clearance to each other body, now vs. after the predicted move.
    // The predicted pose uses the heading of the leg it reaches: at a corner the forks swing with the body.
    const closing = (to: Vector3, heading: number, at: Vector3, limit: number) => {
      const now = controller.clearance(at.x, at.z),
        then = controller.clearance(at.x, at.z, to, heading);
      return then < limit && then <= now + 1e-6;
    };
    let blocked = guarded;
    if (!guarded) {
      controller.predict(step, this.forkliftNext);
      const nextHeading = controller.predictedHeading;
      controller.predict(0.8 * (step / dt), this.forkliftAhead);
      const aheadHeading = controller.predictedHeading;
      blocked = others.some(({ at, radius }) => {
        const limit = radius + AMR_TRAFFIC.safetyMargin;
        return closing(this.forkliftNext, nextHeading, at, limit) || closing(this.forkliftAhead, aheadHeading, at, limit);
      });
    }
    if (!blocked) {
      state.wait = 0;
      return;
    }
    controller.held = controller.moving;
    state.wait += dt;
    if (controller.moving && state.wait >= FORKLIFT_STUCK_S) {
      // Stuck: other side / next rack, or back off along the heading and replan.
      state.wait = 0;
      state.retry = 1;
      controller.blocked();
      return;
    }
    state.retry -= dt;
    if (state.wait < 0.8 || state.retry > 0) return;
    state.retry = 1;
    // Narrow aisle: an idle, empty AMR standing on the route steps into a free pocket instead of the forklift waiting.
    const mover = { id: agent.object.id, position, radius: controller.radius, corridor: [...controller.bodies.map((b) => b.clone()), ...controller.remaining(FORKLIFT_TRAFFIC.makeWayCorridor)] };
    let madeWay = false;
    for (const vehicle of this.trafficVehicles)
      if (vehicle.id !== controller.job?.peerId && this.traffic.makeWay(vehicle, mover, this.trafficVehicles, this.trafficPlan, this.trafficBodies)) madeWay = true;
    if (madeWay) return;
    const extra: NavigationObstacle[] = others.map(({ at, radius }) => ({
      kind: "amr",
      pose: { x: at.x, z: at.z, yaw: 0 },
      radius: Math.max(0, Math.min(radius + AMR_TRAFFIC.safetyMargin, Math.hypot(at.x - position.x, at.z - position.z) - controller.radius - 1e-3)),
    }));
    // Still stuck: joint plan with the nearest AMR (forklift stays / backs off, AMR passes / pockets).
    if (state.wait >= AMR_COOPERATION.after && this.cooperateForklift(agent, step / dt, extra)) return;
    const goal = controller.goal;
    if (!goal || !controller.moving) return;
    const path = this.forkliftRoute(position, goal, controller.loaded, extra);
    if (path) controller.reroute(path);
  }
  private cooperateForklift(agent: FactoryForkliftAgent, factor: number, extra: NavigationObstacle[]) {
    const controller = agent.controller,
      position = controller.carrier.position,
      range = FORKLIFT_TRAFFIC.guardRange;
    let nearest: (typeof this.trafficVehicles)[number] | null = null,
      best = Infinity;
    for (const vehicle of this.trafficVehicles) {
      if (!vehicle.enabled || vehicle.id === controller.job?.peerId) continue;
      const at = vehicle.dispatch.carrier.position,
        distance = Math.hypot(at.x - position.x, at.z - position.z);
      if (distance <= range && distance < best) {
        best = distance;
        nearest = vehicle;
      }
    }
    if (!nearest) return false;
    const heading = controller.carrier.rotation.y,
      backs: { distance: number; path: Vector3[] }[] = [];
    if (controller.moving)
      for (const distance of FORKLIFT_TRAFFIC.coopBack) {
        const end = new Vector3(position.x - Math.sin(heading) * distance, 0, position.z - Math.cos(heading) * distance);
        const route = this.forkliftRoute(position, end, controller.loaded, extra);
        let length = 0;
        if (route) for (let i = 1; i < route.length; i++) length += route[i].distanceTo(route[i - 1]);
        if (route && length <= distance * 1.3 + 0.2) backs.push({ distance, path: [position.clone(), end] });
      }
    const corridor = [...controller.bodies.map((b) => b.clone()), ...controller.remaining(FORKLIFT_TRAFFIC.makeWayCorridor)];
    const back = this.traffic.cooperateForklift(
      nearest,
      { id: agent.object.id, position, radius: controller.radius, circles: controller.bodies, corridor, backs, backSpeed: FORKLIFT_CONFIG.insertSpeed * factor },
      this.trafficVehicles,
      this.trafficBodies,
    );
    if (back === null) return false;
    if (back > 0) controller.backOffFor(back);
    return true;
  }
  /** Door opening for display (0 closed … 1 open). */
  doorOpening(id: string) {
    return this.doorFraction.get(id) ?? 0;
  }
  private doorWaypoints(door: SceneEquipment) {
    const sx = Math.sin(door.yaw), cz = Math.cos(door.yaw);
    // Door-local +Z faces the room interior (see roomWalls.wallFrames).
    return {
      inside: new Vector3(door.x + sx * DOOR_INSIDE, 0, door.z + cz * DOOR_INSIDE),
      outside: new Vector3(door.x - sx * DOOR_OUTSIDE, 0, door.z - cz * DOOR_OUTSIDE),
    };
  }
  /** Forklifts: move every step; about once a second an idle one takes a random stored pallet (any rack) out through a door. */
  private advanceForklifts(dt: number, settings: Record<string, EquipmentSettings>) {
    if (!this.forkliftAgents.length) return;
    for (const agent of this.forkliftAgents) {
      const config = settings[agent.object.id];
      if (!config.enabled) continue;
      const controller = agent.controller;
      const doorId = controller.job?.doorId;
      controller.doorOpen = doorId !== undefined && (this.doorFraction.get(doorId) ?? 0) >= 1;
      const step = dt * amrSpeedFactor(config);
      this.holdForklift(agent, step, dt, settings);
      controller.advance(step);
    }
    for (const door of this.doors) {
      const open = this.forkliftAgents.some((agent) => agent.controller.job?.doorId === door.id && agent.controller.needsDoor);
      const current = this.doorFraction.get(door.id) ?? 0,
        step = dt / DOOR_CONFIG.travelSeconds;
      this.doorFraction.set(door.id, open ? Math.min(1, current + step) : Math.max(0, current - step));
    }
    this.rackUnloadRetry -= dt;
    if (this.rackUnloadRetry > 0) return;
    this.rackUnloadRetry = RACK_UNLOAD_RETRY_S;
    for (const agent of this.forkliftAgents)
      if (agent.controller.idle) agent.waitingReason = null;
    const idle = this.forkliftAgents.filter((agent) => agent.controller.idle && settings[agent.object.id].enabled);
    if (!idle.length) return;
    // 셔틀 구역 pallets join the hand-off queue once an enabled pallet rack has a free slot (nearest rack first).
    for (const zp of this.zonePallets) {
      if (zp.handoff) continue;
      const rack = this.racks.filter((r) => settings[r.id]?.enabled && this.freeSlot(r) >= 0).sort((a, b) => distance(a, zp.zone) - distance(b, zp.zone) || (a.id < b.id ? -1 : 1))[0];
      if (!rack) continue;
      const slot = this.freeSlot(rack);
      this.slotBookings.add(`${rack.id}:${slot}`);
      zp.handoff = { rack, slot, group: zp.group, boxes: zp.boxes, claimed: false };
      this.handoffs.push(zp.handoff);
    }
    // Hand-off pallets first (oldest first), each to the nearest idle forklift that can reach it.
    for (const handoff of this.handoffs) {
      if (handoff.claimed || !idle.length) continue;
      const away = (agent: FactoryForkliftAgent) => distance(agent.controller.carrier.position, handoff.group.position);
      idle.sort((a, b) => away(a) - away(b) || (a.object.id < b.object.id ? -1 : 1));
      for (const agent of idle) {
        if (!agent.controller.start(this.storeJob(handoff, settings))) {
          agent.waitingReason = `${handoff.rack.name} 인계 지점으로 가는 경로가 없습니다.`;
          continue;
        }
        handoff.claimed = true;
        agent.waitingReason = null;
        idle.splice(idle.indexOf(agent), 1);
        break;
      }
    }
    if (!idle.length) return;
    // Every stored pallet in an enabled rack that no forklift has claimed yet (racks need not be full).
    const candidates: { rack: SceneEquipment; slot: number }[] = [];
    for (const rack of this.racks) {
      if (!settings[rack.id]?.enabled) continue;
      const stored = this.rackPallets.get(rack.id) ?? [],
        groups = this.rackGroups.get(rack.id) ?? [];
      for (let slot = 0; slot < stored.length; slot++)
        if (stored[slot] && groups[slot] && !this.unloadClaims.has(`${rack.id}:${slot}`)) candidates.push({ rack, slot });
    }
    if (!candidates.length) return;
    if (!this.doors.length) {
      for (const agent of idle) agent.waitingReason = "반출할 문이 없습니다. 문을 배치해 주세요.";
      return;
    }
    // Random stored pallet across all racks (seeded, advanced only here on sim steps: same picks at any speed).
    while (idle.length && candidates.length) {
      const { rack, slot } = candidates.splice(Math.floor(this.rackRandom() * candidates.length), 1)[0];
      const away = (agent: FactoryForkliftAgent) => distance(agent.controller.carrier.position, rack);
      idle.sort((a, b) => away(a) - away(b));
      const door = [...this.doors].sort((a, b) => distance(a, rack) - distance(b, rack))[0];
      const { inside, outside } = this.doorWaypoints(door);
      const key = `${rack.id}:${slot}`;
      for (const agent of idle) {
        const started = agent.controller.start({
          kind: "retrieve",
          // Front first, then the mirrored standoff on the back side (heading flipped).
          targets: () => this.slotTargets(rack, slot),
          doorId: door.id,
          inside,
          outside,
          pick: () => this.takeFromRack(rack, slot),
          drop: (payload) => this.shipThroughDoor(agent, rack, door, payload, key),
        });
        if (started) {
          this.unloadClaims.add(key);
          agent.waitingReason = null;
          idle.splice(idle.indexOf(agent), 1);
          break;
        }
        agent.waitingReason = `${rack.name} 반출 위치로 가는 경로가 없습니다.`;
      }
    }
  }
  /** A forklift lifted a 셔틀 구역 pallet: the zone is free again. */
  private releaseZone(group: Group) {
    const index = this.zonePallets.findIndex((z) => z.group === group);
    if (index < 0) return;
    this.zoneBookings.delete(this.zonePallets[index].zoneId);
    this.zonePallets.splice(index, 1);
    this.zonePicked++;
  }
  /** One rack hand-off point (floor, in front of the level-1 centre slot) is in use. */
  private handoffBusy(rack: SceneEquipment) {
    return (
      this.handoffs.some((h) => h.rack.id === rack.id && !this.zonePallets.some((z) => z.handoff === h)) ||
      this.shipments.some((s) => s.handoff && s.dock.id === rack.id && !s.stored)
    );
  }
  private handoffPoint(rack: SceneEquipment) {
    const { x } = RACK_CONFIG.slots[HANDOFF_SLOT];
    return rackFacePoint(rack, HANDOFF_SLOT, RACK_CONFIG.front - x + rackStandoff(HANDOFF_EXTRA));
  }
  /**
   * Both ways into a slot: the front (+X loading face) and the mirrored standoff on the back with the
   * heading flipped (double-sided rack). Each stops a fork length short of the insert pose.
   */
  private slotTargets(rack: SceneEquipment, slot: number): ForkliftTarget[] {
    const point = rackSlotPoint(rack, slot),
      heading = rackHeading(rack),
      nx = Math.sin(heading),
      nz = Math.cos(heading),
      depth = (point.x - rack.x) * nx + (point.z - rack.z) * nz,
      mirrored = new Vector3(point.x - 2 * depth * nx, point.y, point.z - 2 * depth * nz);
    return [
      { rackId: rack.id, slot, slotPoint: point, heading, approach: forkliftStop(point, heading, FORKLIFT_CONFIG.forkLength) },
      { rackId: rack.id, slot, slotPoint: mirrored, heading: heading + Math.PI, approach: forkliftStop(mirrored, heading + Math.PI, FORKLIFT_CONFIG.forkLength) },
    ];
  }
  /**
   * Store job for a hand-off pallet. Targets in order: the booked slot from the front, the same slot
   * from the back, then the nearest other enabled racks with a free slot (distance, then id) front/back.
   * Moving to another slot books it and releases the previous booking.
   */
  private storeJob(handoff: Handoff, settings: Record<string, EquipmentSettings>): ForkliftJob {
    const rack = handoff.rack;
    return {
      kind: "store",
      pickup: { point: handoff.group.position.clone(), heading: rackHeading(rack) },
      targets: () => {
        const own = this.slotTargets(rack, handoff.slot);
        const from = handoff.group.parent ? handoff.group.getWorldPosition(new Vector3()) : handoff.group.position;
        const others = this.racks
          .filter((other) => other.id !== rack.id && settings[other.id]?.enabled && this.freeSlot(other) >= 0)
          .sort((a, b) => distance(a, from) - distance(b, from) || (a.id < b.id ? -1 : 1));
        return [...own, ...others.flatMap((other) => this.slotTargets(other, this.freeSlot(other)))];
      },
      claim: (target) => {
        const key = `${target.rackId}:${target.slot}`,
          current = `${handoff.rack.id}:${handoff.slot}`;
        if (key === current) return true;
        if (this.rackStored.get(target.rackId)?.[target.slot] || this.slotBookings.has(key)) return false;
        const next = this.racks.find((r) => r.id === target.rackId);
        if (!next) return false;
        this.slotBookings.delete(current);
        this.slotBookings.add(key);
        log("info", `${handoff.rack.name} 적재 불가 · ${next.name}(으)로 대체 적재`, `팔레트 ${handoff.palletId ?? "-"}`);
        handoff.rack = next;
        handoff.slot = target.slot;
        return true;
      },
      take: () => {
        this.handoffs.splice(this.handoffs.indexOf(handoff), 1);
        this.releaseZone(handoff.group);
        return handoff.group;
      },
      store: (payload, target) => this.storeFromForklift(handoff, payload, target),
    };
  }
  /** The forklift has lowered the pallet onto the shelf: it becomes a stored rack pallet. */
  private storeFromForklift(handoff: Pick<Handoff, "boxes" | "palletId">, payload: Group, target: Pick<ForkliftTarget, "rackId" | "slot">) {
    const rack = this.racks.find((r) => r.id === target.rackId)!;
    this.slotBookings.delete(`${rack.id}:${target.slot}`);
    payload.parent?.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, false);
    this.root.attach(payload);
    payload.position.copy(rackSlotPoint(rack, target.slot));
    const yaw = new Euler().setFromQuaternion(payload.quaternion, "YXZ").y;
    payload.rotation.set(0, rack.yaw + (Math.PI / 2) * Math.round((yaw - rack.yaw) / (Math.PI / 2)), 0);
    this.rackStored.get(rack.id)![target.slot] = true;
    { const kinds = this.rackContent.get(rack.id); if (kinds) kinds[target.slot] = handoff.boxes.length ? "palletBoxes" : "pallet"; }
    // Stored for the rest of its stay: re-register so the instancer treats it as static.
    payload.userData.instanceStatic = true;
    this.unrender(payload);
    for (const box of handoff.boxes) this.unrender(box);
    this.render(payload);
    for (const box of handoff.boxes) this.render(box);
    if (handoff.palletId) {
      this.cargo.storePallet({ t: this.elapsed, palletId: handoff.palletId, rackId: rack.id, slot: target.slot });
      const record = this.cargo.pallet(handoff.palletId);
      const slots = this.rackPallets.get(rack.id);
      if (record && slots) slots[target.slot] = { id: record.id, grade: record.grade, boxes: record.boxIds.length, storedAt: this.elapsed };
    }
    const groups = this.rackGroups.get(rack.id);
    if (groups) groups[target.slot] = { group: payload, boxes: handoff.boxes };
    this.forkliftStored++;
    log("info", `지게차가 팔레트 ${handoff.palletId ?? "-"} ${rack.name} ${RACK_CONFIG.slots[target.slot]?.name ?? target.slot} 칸에 적재`);
  }
  /** Frees the slot and hands its pallet (with boxes) to the forklift as a dynamic object. */
  private takeFromRack(rack: SceneEquipment, slot: number) {
    const groups = this.rackGroups.get(rack.id),
      stored = groups?.[slot];
    if (!groups || !stored) return null;
    groups[slot] = undefined;
    this.rackStored.get(rack.id)![slot] = false;
    { const kinds = this.rackContent.get(rack.id); if (kinds) kinds[slot] = undefined; }
    const record = this.rackPallets.get(rack.id)![slot];
    this.rackPallets.get(rack.id)![slot] = undefined;
    stored.group.userData.instanceStatic = false;
    stored.group.userData.rackPallet = record?.id;
    stored.group.userData.rackBoxes = stored.boxes;
    // Re-register so the instancer treats the pallet and boxes as moving (static sectors are fixed at registration).
    this.unrender(stored.group);
    for (const box of stored.boxes) this.unrender(box);
    this.render(stored.group);
    for (const box of stored.boxes) this.render(box);
    log("info", `${rack.name}에서 팔레트 ${record?.id ?? ""} 반출 시작`.replace("  ", " "));
    return stored.group;
  }
  private shipThroughDoor(agent: FactoryForkliftAgent, rack: SceneEquipment, door: SceneEquipment, payload: Group, key: string) {
    this.unloadClaims.delete(key);
    const palletId = payload.userData.rackPallet as string | undefined,
      boxes = (payload.userData.rackBoxes as Group[] | undefined) ?? [];
    this.unrender(payload);
    for (const box of boxes) this.unrender(box);
    payload.removeFromParent();
    payload.clear();
    if (palletId && this.cargo.pallet(palletId)) this.cargo.shipPallet({ t: this.elapsed, palletId, dockId: door.id });
    this.unloaded++;
    log("info", `팔레트 ${palletId ?? "-"} ${door.name} 밖으로 반출 완료`, `${rack.name} · ${agent.object.name}`);
  }
  get status() {
    const active = this.agents.find((agent) => agent.dispatch.phase !== "idle");
    if (active) return `${active.object.name} · ${active.dispatch.status}`;
    const robot = this.robots.find((robot) => robot.busy);
    if (robot) return `${robot.object.name} · ${robot.status}`;
    if (this.pallets.some((p) => p.count === p.slots.length))
      return "팔레트 적재 완료 · 운반 가능한 AMR 대기";
    return `${this.robots.length}대 로봇 · 범위 내 박스 대기`;
  }
  private lastEquipment: EquipmentSnapshot | null = null;
  /** Snapshot with structural sharing: unchanged items and arrays keep their identity. */
  get equipment(): EquipmentSnapshot {
    const next = this.buildEquipment(), prev = this.lastEquipment;
    const snapshot: EquipmentSnapshot = prev
      ? {
          ...next,
          scanners: shareItems(prev.scanners, next.scanners),
          robots: shareItems(prev.robots, next.robots)!,
          agents: shareItems(prev.agents, next.agents)!,
          pallets: shareItems(prev.pallets, next.pallets)!,
        }
      : next;
    this.lastEquipment = snapshot;
    return snapshot;
  }
  /** Typed state for a vehicle row: category from which fleet it belongs to. */
  private withOperation(row: AgentRow): AgentRow {
    const category = this.agents.some((a) => a.object.id === row.id) ? "amr" : this.forkliftAgents.some((a) => a.object.id === row.id) ? "forklift" : "cycle";
    return { ...row, category, operation: vehicleState(category, row.state, row.status).state };
  }
  private buildEquipment(): EquipmentSnapshot {
    const settings = this.settings();
    return {
      elapsed: this.elapsed,
      scanners: this.inspection.snapshots,
      robots: this.robots.map((robot): EquipmentSnapshot["robots"][number] => ({
        id: robot.object.id,
        name: robot.object.name,
        count: robot.count,
        utilization: this.elapsed
          ? Math.min(100, (robot.busySeconds / this.elapsed) * 100)
          : 0,
        state: !settings[robot.object.id].enabled
          ? "disabled"
          : robot.busy
            ? "working"
            : "idle",
        status: robot.busy ? robot.status : robot.warning ?? "범위 내 박스 대기",
      })).map((row) => ({ ...row, category: "robotArm" as const, operation: robotArmState(row.state, row.status).state })),
      agents: [...this.agents.map((agent): AgentRow => ({
        id: agent.object.id,
        name: agent.object.name,
        state: !settings[agent.object.id].enabled
          ? "disabled"
          : agent.charging
            ? "charging"
          : agent.dispatch.yielding
            ? "yielding"
            : agent.waiting && agent.dispatch.phase === "idle"
              ? "waiting"
              : agent.dispatch.phase,
        status: agent.charging
          ? `대기 위치 충전 중 · ${AMR_BATTERY.chargedAt}%까지 출고 배정 제외`
          : agent.waiting && agent.dispatch.phase === "idle"
            ? (agent.waitingReason ?? "운반 가능한 안전 경로를 기다립니다.")
            : agent.dispatch.status,
        target: agent.target,
        completed: agent.completed,
        battery: Math.round(agent.battery * 10) / 10,
      })),
      ...this.forkliftAgents.map((agent): AgentRow => {
        const controller = agent.controller,
          enabled = settings[agent.object.id].enabled;
        return {
          id: agent.object.id,
          name: agent.object.name,
          state: !enabled
            ? ("disabled" as const)
            : controller.idle
              ? agent.waitingReason ? ("waiting" as const) : ("idle" as const)
              : controller.loaded ? ("dispatch" as const) : ("pickup" as const),
          status: controller.idle ? (agent.waitingReason ?? controller.status) : controller.status,
          target: controller.target ? (this.racks.find((rack) => rack.id === controller.target!.rackId)?.name ?? null) : null,
          completed: controller.completed + controller.stored,
          battery: 100,
        };
      }), ...(this.cycle?.agentRows() ?? [])].map((row) => this.withOperation(row)),
      cycle: this.cycle?.snapshot,
      pallets: this.pallets.map((pallet) => ({
        id: pallet.object.id,
        name: pallet.object.name,
        count: pallet.count,
        capacity: pallet.slots.length,
        shipping: pallet.shipping,
      })),
      // Display only: slot occupancy (stored) and bookings by deliveries in progress (reserved).
      racks: this.racks.map((rack) => ({
        id: rack.id,
        slots: (this.rackStored.get(rack.id) ?? []).map((filled, slot) => {
          const stored = this.rackPallets.get(rack.id)?.[slot];
          if (filled)
            return { state: "stored" as const, content: this.rackContent.get(rack.id)?.[slot] ?? ("palletBoxes" as const), palletId: stored?.id, boxes: stored?.boxes, grade: stored?.grade, storedAt: stored?.storedAt };
          const shipment = this.shipments.find((s) => s.dock.id === rack.id && s.slot === slot);
          const record = this.cargo.pallet(shipment?.palletId);
          return shipment
            ? { state: "reserved" as const, palletId: shipment.palletId, boxes: record?.boxIds.length, grade: record?.grade }
            : { state: "empty" as const };
        }),
      })),
    };
  }
  private readonly kpiSample = (): KpiSample => {
    const rows = this.buildEquipment(), stats = this.stats;
    const positions = new Map<string, { x: number; z: number }>();
    for (const agent of this.agents) positions.set(agent.object.id, agent.dispatch.carrier.position);
    for (const agent of this.forkliftAgents) positions.set(agent.object.id, agent.controller.carrier.position);
    // Pallet-cycle vehicles: their own work classification (their display rows call robot loading "loading" = busy).
    const CYCLE_STATE = { busy: "transferring", waiting: "waiting", blocked: "blocked", idle: "idle" } as const;
    const CYCLE_PHASE = { busy: "dispatch", waiting: "waiting", blocked: "blocked", idle: "idle" } as const;
    const cycle = new Map((this.cycle?.kpiActors() ?? []).map((actor) => [actor.id, actor]));
    return {
      counters: { boxesIn: stats.spawned, placed: stats.placed, passed: stats.passed, palletsIn: this.unloaded, palletsShipped: stats.completedPallets ?? 0, wip: stats.live },
      equipment: [...rows.robots, ...rows.agents].flatMap((row) => {
        const actor = cycle.get(row.id), state = actor && row.operation !== "disabled" ? CYCLE_STATE[actor.work] : row.operation;
        return row.category && state ? [{ id: row.id, name: row.name, category: row.category, state }] : [];
      }),
      vehicles: rows.agents.flatMap((row) => {
        const actor = cycle.get(row.id);
        if (actor) return [{ id: row.id, x: actor.x, z: actor.z, phase: row.state === "disabled" ? "disabled" : CYCLE_PHASE[actor.work] }];
        const p = positions.get(row.id);
        return p ? [{ id: row.id, x: p.x, z: p.z, phase: row.state }] : [];
      }),
    };
  };
  get stats(): StreamStats {
    return {
      spawned: this.spawned,
      placed: this.placed,
      passed: this.passed,
      live: this.boxes.filter(
        (b) => b.state === "moving" || b.state === "reserved",
      ).length,
      completedPallets: this.dispatched,
      utilization: 0,
      full: false,
      size: "",
    };
  }
}

function shallowEqual(a: object, b: object) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function shareItems<T extends object>(prev: T[] | undefined, next: T[] | undefined): T[] | undefined {
  if (!prev || !next) return next;
  let changed = prev.length !== next.length;
  const out = next.map((item, i) => {
    const old = prev[i];
    if (old && shallowEqual(old, item)) return old;
    changed = true;
    return item;
  });
  return changed ? out : prev;
}
