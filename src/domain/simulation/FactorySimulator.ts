import { ScannerInspection } from "@/domain/scanner/ScannerInspection";
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
import { BOX_SIZES, STREAM_CONFIG, ROBOT_PICKING, PALLET_STACKING } from "@/constants/simulation";
import { DEFAULT_LAYOUT, AMR_TRAFFIC, AMR_BATTERY } from "@/constants/simulatorLayout";
import { createUnitBox } from "@/lib/three/modelNormalization";
import { amrSpeedFactor, beltSpeedOf, spawnIntervalOf } from "@/domain/simulation/equipmentSpeeds";
import { RACK_CONFIG, rackApproachPoint, rackSlotPoint } from "@/constants/rack";
import { LinkIndex, type SceneLink } from "@/types/links";
import { TransportQueue } from "@/domain/amr/TransportQueue";
import { PalletController } from "@/domain/pallet/PalletController";
import { PalletDispatchController } from "@/domain/amr/PalletDispatchController";
import { AMRTrafficController } from "@/domain/amr/AMRTrafficController";
import type { DispatchRoutes } from "@/domain/amr/PalletDispatchController";
import { layoutPath, routeFailureReason } from "@/domain/amr/navigation/layoutNavigation";
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
import { RackAMRController } from "@/domain/amr/RackAMRController";
import { DOOR_CONFIG } from "@/constants/door";

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
/** FNV-1a hash of the scene layout (ids, kinds, poses): the rack AMR PRNG seed. */
function sceneSeed(objects: readonly SceneEquipment[]) {
  let hash = 0x811c9dc5;
  for (const o of objects)
    for (const ch of `${o.id}|${o.kind}|${o.x.toFixed(3)}|${o.z.toFixed(3)}|${o.yaw.toFixed(3)};`)
      hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193);
  return hash >>> 0;
}

type Cargo = {
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
/** Dedicated rack-unloading AMR (amrRole "rack"); see RackAMRController. */
export type FactoryRackAgent = {
  object: SceneEquipment;
  controller: RackAMRController;
  /** Why the last assignment attempt failed (shown while idle). */
  waitingReason: string | null;
};
/** A pallet stored in a rack slot: its group and the box nodes registered for rendering. */
type StoredPallet = { group: Group; boxes: Group[] };
/** Seconds between rack-unload assignment checks (sim time). */
const RACK_UNLOAD_RETRY_S = 1;
/** Distance of the inside / outside door waypoints from the door plane (m). */
const DOOR_INSIDE = 1.6;
const DOOR_OUTSIDE = 2;
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

/** Placeholder pose far from the scene for unused FactoryLayout entries of rack AMR routing. */
const FAR_POSE = { x: 1e5, z: 1e5, yaw: 0 };
const palletGrade = (config: EquipmentSettings | undefined): CargoGrade =>
  config?.grade ?? "normal";
export class FactorySimulator {
  readonly root = new Group();
  readonly inspection: ScannerInspection;
  /** Per-box / per-pallet records; a new registry per run (cleared on STOP). */
  readonly cargo = new CargoRegistry((message) => log("warning", "박스 추적", message));
  private scanFrom = new Vector3();
  private scanTo = new Vector3();
  readonly robots: FactoryRobot[] = [];
  readonly agents: FactoryAgent[] = [];
  readonly rackAgents: FactoryRackAgent[] = [];
  /** Rack AMR pallet choice; seeded from the scene layout so every run (and playback speed) picks the same pallets. */
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
  readonly transport = new TransportQueue();
  /** Stations whose current full pallet was already reported (palletFull log); cleared on replacement. */
  private fullReported = new Set<PalletController>();
  /** Per-step scratch (advance runs every fixed step; avoid allocations). */
  private readonly reachableScratch = new Set<CargoGrade>();
  private readonly shipmentScratch: Shipment[] = [];
  constructor(
    objects: SceneEquipment[],
    box: Group,
    pallet: Group,
    getSettings: () => Record<string, EquipmentSettings>,
    instances?: SimulationRenderer,
    random: () => number = Math.random,
    links: readonly SceneLink[] = [],
  ) {
    this.links = new LinkIndex(links);
    this.rackRandom = mulberry32(sceneSeed(objects));
    this.inspection = new ScannerInspection(getSettings, random);
    this.instances = instances;
    this.settings = getSettings;
    this.boxAsset = createUnitBox(box);
    // Boxes only receive shadows (hundreds of small casters); see SceneInstances.
    this.boxAsset.traverse((node) => { node.userData.noCastShadow = true; });
    for (const object of objects) {
      if (object.kind === "robot")
        this.robots.push({
          object,
          jobs: [],
          busy: false,
          completed: 0,
          status: "범위 내 박스 대기",
          count: 0,
          busySeconds: 0,
        });
      if (object.kind === "conveyor") this.belts.push({ object, elapsed: 0 });
      if (object.kind === "pallet") {
        const state = new PalletController(object, pallet, this.settings()[object.id].capacity);
        this.pallets.push(state);
        this.root.add(state.group);
        this.render(state.group);
      }
      if (object.kind === "amr" && this.settings()[object.id]?.amrRole === "rack")
        this.rackAgents.push({
          object,
          controller: new RackAMRController(object, (from, to, loaded) => this.rackRoute(from, to, loaded)),
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
    for (const agent of this.rackAgents) agent.controller.carrier.userData.sceneId = agent.object.id;
    this.doors = objects.filter((o) => o.kind === "door");
    for (const door of this.doors) this.doorFraction.set(door.id, 0);
    this.trafficVehicles = this.agents.map((agent) => ({
      id: agent.object.id,
      dispatch: agent.dispatch,
      speed: 1,
      enabled: true,
    }));
    const connections = beltConnections(objects);
    this.connections = connections.next;
    this.incoming = connections.incoming;
    // Belts start empty; boxes only come from regular inlet spawning in advance().
    this.docks = objects.filter((o) => o.kind === "dock");
    this.racks = objects.filter((o) => o.kind === "rack");
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
      ...this.robots.map((r) => ({ kind: r.object.kind, pose: r.object })),
      ...this.belts.map((b) => ({ kind: b.object.kind, pose: b.object })),
      ...this.pallets.map((p) => ({ kind: p.object.kind, pose: p.object })),
      ...this.racks.map((r) => ({ kind: r.kind, pose: r })),
    ];
    for (const robot of this.robots) {
      const fed = this.links.incoming(robot.object.id, "feed");
      if (fed.length) {
        const belts = new Set<string>();
        for (const id of fed) for (const belt of connectedBeltIds(objects, id)) belts.add(belt);
        this.feedBelts.set(robot.object.id, belts);
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
      if (!loaders.length) {
        const nearest = this.robots.reduce<FactoryRobot | null>((best, next) =>
          !best || distance(next.object, pallet.object) < distance(best.object, pallet.object) ? next : best, null);
        loaders = nearest ? [nearest] : [];
      }
      pallet.orderFrom(loaders.map((robot) => ({ x: robot.object.x, z: robot.object.z, reach: this.settings()[robot.object.id]?.reach ?? Infinity })));
    }
    this.inspection.onScan = (node, scannerId, result) => {
      if (node.userData.boxId)
        this.cargo.scanBox({ t: this.elapsed, boxId: node.userData.boxId, scannerId, result: result === "fault" ? "defect" : "normal" });
    };
    for (const pallet of this.pallets) this.startPalletRecord(pallet);
  }
  /** Linked subset of `items` when `linked` is non-empty, else all of them (fallback). */
  private linkedOrAll<T>(items: readonly T[], linked: readonly string[], id: (item: T) => string) {
    if (!linked.length) return [...items];
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
  private racks: SceneEquipment[] = [];
  /** Filled PalletPoints per rack; stored pallets stay for the rest of the run. */
  private rackStored = new Map<string, boolean[]>();
  /** Display only: pallet stored in each rack slot (kept here; finished cargo records are evicted). */
  private rackPallets = new Map<string, ({ id: string; grade: CargoGrade; boxes: number; storedAt: number } | undefined)[]>();
  /** Scene nodes of stored pallets, so the rack AMR can take them out again. */
  private rackGroups = new Map<string, (StoredPallet | undefined)[]>();
  private doors: SceneEquipment[] = [];
  /** Door opening 0..1 driven by rack AMR traffic (sim time; display reads it). */
  private doorFraction = new Map<string, number>();
  /** "rackId:slot" pallets already claimed by a rack AMR job. */
  private unloadClaims = new Set<string>();
  private rackUnloadRetry = 0;
  private rackLayout!: FactoryLayout;
  private rackObstacles: NavigationObstacle[] = [];
  /** Pallets taken out of racks and shipped through a door. */
  unloaded = 0;
  /** First PalletPoint that is neither filled nor booked by a delivery in progress. */
  private freeSlot(rack: SceneEquipment) {
    const stored = this.rackStored.get(rack.id) ?? [];
    return stored.findIndex(
      (filled, slot) =>
        !filled && !this.shipments.some((s) => s.dock.id === rack.id && s.slot === slot),
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
    if (this.renderingActive)
      for (const object of this.rendered) this.instances?.unregister(object);
    this.renderingActive = false;
  }
  private spawn(belt: SceneEquipment, offset = 0) {
    const node = new Group(),
      model = this.boxAsset.clone(true);
    model.scale.copy(BOX_SIZES[0]);
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
    box.node.position.set(point.x, 0.25 + BOX_SIZES[0].y, point.z);
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

  advance(dt: number) {
    const settings = this.settings();
    this.elapsed += dt;
    for (const robot of this.robots)
      if (robot.busy && settings[robot.object.id].enabled)
        robot.busySeconds += dt;
    for (const belt of this.belts) {
      const config = settings[belt.object.id];
      if (!config.enabled || this.incoming.has(belt.object.id)) continue;
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
          if (config.enabled)
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
      // Legacy safety net (should not trigger with the end stopper).
      if (box.distance > beltLength(box.belt) + 1 && box.state === "moving") {
        box.state = "passed";
        this.cargo.passBox({ t: this.elapsed, boxId: box.id, beltId: box.belt.id });
        box.node.removeFromParent();
        this.unrender(box.node);
        this.passed++;
        removed = true;
      }
    }
    if (removed)
      this.boxes = this.boxes.filter((box) => box.state !== "passed");
    for (const robot of this.robots) {
      const config = settings[robot.object.id];
      if (robot.busy || !config.enabled) continue;
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
        for (const box of this.boxes) {
          if (box.state !== "moving") continue;
          const feed = this.feedBelts.get(robot.object.id);
          if (feed && !feed.has(box.belt.id)) continue;
          const boxGrade = this.grade(box);
          // Non-matching boxes are left on the belt and continue downstream.
          if (filter !== "all" && boxGrade !== filter) continue;
          if (
            boxGrade !== grade &&
            (filter !== "all" || reachable.has(boxGrade))
          )
            continue;
          if (
            box.attempted.has(robot.object.id) ||
            distance(robot.object, box.node.position) > config.reach - 0.05
          )
            continue;
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
          if (distance(robot.object, this.point) > config.reach - ROBOT_PICKING.pickReachMargin) continue;
          this.assign(robot, pallet, slot, box);
          assigned = true;
          break;
        }
        if (assigned) break;
      }
    }
    for (const vehicle of this.trafficVehicles) {
      vehicle.speed = amrSpeedFactor(settings[vehicle.id]);
      vehicle.enabled = settings[vehicle.id].enabled;
    }
    const rackBodies = this.rackAgents
      .filter((agent) => settings[agent.object.id].enabled)
      .map((agent) => ({ position: agent.controller.carrier.position, radius: agent.controller.radius }));
    this.traffic.advance(this.trafficVehicles, dt, (vehicle, target) => {
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
        if (other.object.id === vehicle.id) continue;
        const at = other.dispatch.carrier.position,
          radius = Math.max(
            0,
            Math.min(
              other.dispatch.radius + AMR_TRAFFIC.safetyMargin,
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
      // Rack AMRs are moving obstacles too (shrunk like the AMRs above when already touching).
      for (const body of rackBodies) {
        const at = body.position,
          radius = Math.max(0, Math.min(body.radius + AMR_TRAFFIC.safetyMargin, Math.hypot(at.x - position.x, at.z - position.z) - own - 1e-3));
        if (!target && Math.hypot(at.x - goal.x, at.z - goal.z) < radius + dispatch.radiusAt(goal)) continue;
        obstacles.push({ kind: "amr", pose: { x: at.x, z: at.z, yaw: 0 }, radius });
      }
      if (dispatch.phase === "returning")
        obstacles.push({ kind: "pallet", pose: navigation.layout.pallet });
      return layoutPath(
        navigation.layout,
        dispatch.carrier.position,
        goal,
        dispatch.radius === AMR_TRAFFIC.loadedRadius,
        obstacles,
      );
    }, rackBodies);
    this.advanceBatteries(dt, settings);
    this.advanceRackAgents(dt, settings);
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
          !(a.dispatch.phase === "returning" && a.battery < AMR_BATTERY.chargeBelow),
      );
      if (!agents.length) continue;
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
  /** Drain while moving, trickle while idle; an idle AMR below the threshold charges in place. */
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
      // A transfer in progress always finishes; charging starts once the AMR is idle again.
      if (idle && agent.battery < AMR_BATTERY.chargeBelow) agent.charging = true;
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
        box.state === "reserved" && box.distance < beltLength(box.belt),
      onPick: () => {
        box.state = "held";
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
    const accepting = this.linkedOrAll([...this.docks, ...this.racks], this.links.outgoing(pallet.object.id, "deliver"), (d) => d.id).filter((dock) => {
      const config = settings[dock.id],
        accepts = config.acceptGrade ?? "any";
      return config.enabled && (accepts === "any" || accepts === grade);
    });
    // One pallet per dock: skip docks booked by another delivery or still holding a drop.
    const docks = accepting
      .filter((dock) =>
        dock.kind === "rack"
          ? this.freeSlot(dock) >= 0
          : !this.shipments.some((s) => s.dock.id === dock.id),
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
    ];
    const pickup = layoutPath(
      layout,
      layout.amr,
      layout.pallet,
      false,
      obstacles,
    );
    if (!pickup) {
      agent.waitingReason ??= routeFailureReason(
        layout,
        layout.amr,
        layout.pallet,
        false,
        obstacles,
        `${pallet.object.name} 픽업`,
      );
      return false;
    }
    let routes: DispatchRoutes | null = null;
    let target: SceneEquipment | null = null,
      targetSlot: number | undefined;
    for (const destination of docks) {
      // A rack is reached at the floor point in front of its first free slot.
      const slot = destination.kind === "rack" ? this.freeSlot(destination) : undefined;
      const approach = slot === undefined ? null : rackApproachPoint(destination, slot);
      const dock = approach
        ? { ...destination, x: approach.x, z: approach.z }
        : destination;
      layout.dock = dock;
      const outbound = layoutPath(layout, layout.pallet, dock, true, obstacles);
      if (!outbound) {
        agent.waitingReason ??= routeFailureReason(
          layout,
          layout.pallet,
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
      routes = { pickup, dispatch: outbound, returning };
      if (slot !== undefined)
        routes.store = {
          slot: rackSlotPoint(destination, slot),
          // Face into the rack: its loading face looks along local +Z.
          heading: destination.yaw + Math.PI,
        };
      layout.dock = dock;
      target = destination;
      targetSlot = slot;
      break;
    }
    if (!routes || !target) return false;
    const group = pallet.beginShipment();
    if (!group) return false;
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
    agent.dispatch.request(
      shipment.group,
      () => {
        // Release the lowered pallet onto the dock, square to it; removed once the AMR clears.
        // In a rack it is placed exactly on its PalletPoint and stays.
        const group = shipment.group,
          dock = shipment.dock;
        group.parent?.updateWorldMatrix(true, false);
        this.root.updateWorldMatrix(true, false);
        this.root.attach(group);
        if (shipment.slot !== undefined) {
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
        group.rotation.set(
          0,
          dock.yaw + (Math.PI / 2) * Math.round((yaw - dock.yaw) / (Math.PI / 2)),
          0,
        );
        shipment.dropped = shipment.slot === undefined;
        this.transport.complete({ t: this.elapsed, stationId: shipment.pallet.object.id, agentId: agent.object.id });
        this.dispatched++;
        agent.completed++;
        agent.target = null;
      },
      routes,
    );
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
    this.root.add(pallet.replace());
    this.render(pallet.group);
    this.startPalletRecord(pallet);
  }
  /** Rack AMR floor route around fixed equipment (other AMRs are not considered). */
  private rackRoute(from: Vector3, to: Vector3, loaded: boolean, extra: NavigationObstacle[] = []) {
    return layoutPath(this.rackLayout, from, to, loaded, extra.length ? [...this.rackObstacles, ...extra] : this.rackObstacles);
  }
  /** Rack AMR traffic: wait seconds per rack AMR while held, and the next detour attempt. */
  private rackTraffic = new Map<string, { wait: number; retry: number }>();
  private rackAhead = new Vector3();
  private rackNext = new Vector3();
  /**
   * Holds a driving rack AMR short of any other AMR body (regular or rack) it would close in on; after
   * waiting a while it plans a detour around them. Regular AMRs treat rack AMRs as bodies to keep clear of.
   */
  private holdRackAgent(agent: FactoryRackAgent, step: number, dt: number, settings: Record<string, EquipmentSettings>) {
    const controller = agent.controller,
      position = controller.carrier.position;
    const state = this.rackTraffic.get(agent.object.id) ?? { wait: 0, retry: 0 };
    this.rackTraffic.set(agent.object.id, state);
    controller.held = false;
    if (!controller.moving) {
      state.wait = 0;
      return;
    }
    controller.predict(step, this.rackNext);
    controller.predict(0.8 * (step / dt), this.rackAhead);
    const others: { at: Vector3; radius: number }[] = [];
    for (const other of this.agents)
      if (settings[other.object.id].enabled) others.push({ at: other.dispatch.carrier.position, radius: other.dispatch.radius });
    for (const other of this.rackAgents)
      if (other !== agent && settings[other.object.id].enabled) others.push({ at: other.controller.carrier.position, radius: other.controller.radius });
    const closing = (to: Vector3, at: Vector3, limit: number) => {
      const now = Math.hypot(position.x - at.x, position.z - at.z),
        then = Math.hypot(to.x - at.x, to.z - at.z);
      return then < limit && then <= now + 1e-6;
    };
    const blocked = others.some(({ at, radius }) => {
      const limit = controller.radius + radius + AMR_TRAFFIC.safetyMargin;
      return closing(this.rackNext, at, limit) || closing(this.rackAhead, at, limit);
    });
    if (!blocked) {
      state.wait = 0;
      return;
    }
    controller.held = true;
    state.wait += dt;
    state.retry -= dt;
    if (state.wait < 0.8 || state.retry > 0) return;
    state.retry = 1;
    const goal = controller.goal;
    if (!goal) return;
    const extra: NavigationObstacle[] = others.map(({ at, radius }) => ({
      kind: "amr",
      pose: { x: at.x, z: at.z, yaw: 0 },
      radius: Math.max(0, Math.min(radius + AMR_TRAFFIC.safetyMargin, Math.hypot(at.x - position.x, at.z - position.z) - controller.radius - 1e-3)),
    }));
    const path = this.rackRoute(position, goal, controller.loaded, extra);
    if (path) controller.reroute(path);
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
  /** Rack AMRs: move every step; about once a second an idle one takes a random stored pallet (any rack) out through a door. */
  private advanceRackAgents(dt: number, settings: Record<string, EquipmentSettings>) {
    if (!this.rackAgents.length) return;
    for (const agent of this.rackAgents) {
      const config = settings[agent.object.id];
      if (!config.enabled) continue;
      const controller = agent.controller;
      const doorId = controller.job?.doorId;
      controller.doorOpen = doorId !== undefined && (this.doorFraction.get(doorId) ?? 0) >= 1;
      const step = dt * amrSpeedFactor(config);
      this.holdRackAgent(agent, step, dt, settings);
      controller.advance(step);
    }
    for (const door of this.doors) {
      const open = this.rackAgents.some((agent) => agent.controller.job?.doorId === door.id && agent.controller.needsDoor);
      const current = this.doorFraction.get(door.id) ?? 0,
        step = dt / DOOR_CONFIG.travelSeconds;
      this.doorFraction.set(door.id, open ? Math.min(1, current + step) : Math.max(0, current - step));
    }
    this.rackUnloadRetry -= dt;
    if (this.rackUnloadRetry > 0) return;
    this.rackUnloadRetry = RACK_UNLOAD_RETRY_S;
    for (const agent of this.rackAgents)
      if (agent.controller.idle) agent.waitingReason = null;
    const idle = this.rackAgents.filter((agent) => agent.controller.idle && settings[agent.object.id].enabled);
    if (!idle.length) return;
    // Every stored pallet in an enabled rack that no rack AMR has claimed yet (racks need not be full).
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
      const away = (agent: FactoryRackAgent) => distance(agent.controller.carrier.position, rack);
      idle.sort((a, b) => away(a) - away(b));
      const door = [...this.doors].sort((a, b) => distance(a, rack) - distance(b, rack))[0];
      const { inside, outside } = this.doorWaypoints(door);
      const approach = rackApproachPoint(rack, slot);
      const key = `${rack.id}:${slot}`;
      for (const agent of idle) {
        const started = agent.controller.start({
          rackId: rack.id,
          slot,
          approach,
          slotPoint: rackSlotPoint(rack, slot),
          heading: rack.yaw + Math.PI,
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
  /** Frees the slot and hands its pallet (with boxes) to the rack AMR as a dynamic object. */
  private takeFromRack(rack: SceneEquipment, slot: number) {
    const groups = this.rackGroups.get(rack.id),
      stored = groups?.[slot];
    if (!groups || !stored) return null;
    groups[slot] = undefined;
    this.rackStored.get(rack.id)![slot] = false;
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
  private shipThroughDoor(agent: FactoryRackAgent, rack: SceneEquipment, door: SceneEquipment, payload: Group, key: string) {
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
  private buildEquipment(): EquipmentSnapshot {
    const settings = this.settings();
    return {
      elapsed: this.elapsed,
      scanners: this.inspection.snapshots,
      robots: this.robots.map((robot) => ({
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
        status: robot.busy ? robot.status : "범위 내 박스 대기",
      })),
      agents: this.agents.map((agent) => ({
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
          ? `제자리 충전 중 · ${AMR_BATTERY.chargedAt}%까지 출고 배정 제외`
          : agent.waiting && agent.dispatch.phase === "idle"
            ? (agent.waitingReason ?? "운반 가능한 안전 경로를 기다립니다.")
            : agent.dispatch.status,
        target: agent.target,
        completed: agent.completed,
        battery: Math.round(agent.battery * 10) / 10,
      })),
      ...this.rackAgents.map((agent) => {
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
          target: controller.job ? (this.racks.find((rack) => rack.id === controller.job!.rackId)?.name ?? null) : null,
          completed: controller.completed,
          battery: 100,
        };
      }),
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
            return { state: "stored" as const, palletId: stored?.id, boxes: stored?.boxes, grade: stored?.grade, storedAt: stored?.storedAt };
          const shipment = this.shipments.find((s) => s.dock.id === rack.id && s.slot === slot);
          const record = this.cargo.pallet(shipment?.palletId);
          return shipment
            ? { state: "reserved" as const, palletId: shipment.palletId, boxes: record?.boxIds.length, grade: record?.grade }
            : { state: "empty" as const };
        }),
      })),
    };
  }
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
