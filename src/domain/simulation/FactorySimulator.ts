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
import { BOX_SIZES, STREAM_CONFIG, MOTION } from "@/constants/simulation";
import { DEFAULT_LAYOUT, AMR_TRAFFIC, AMR_BATTERY } from "@/constants/simulatorLayout";
import { createUnitBox } from "@/lib/three/modelNormalization";
import { amrSpeedFactor, beltSpeedOf, spawnIntervalOf } from "@/domain/simulation/equipmentSpeeds";
import { RACK_CONFIG, rackApproachPoint, rackSlotPoint } from "@/constants/rack";
import { PalletController } from "@/domain/pallet/PalletController";
import { PalletDispatchController } from "@/domain/amr/PalletDispatchController";
import { AMRTrafficController } from "@/domain/amr/AMRTrafficController";
import type { DispatchRoutes } from "@/domain/amr/PalletDispatchController";
import { layoutPath, routeFailureReason } from "@/domain/amr/navigation/layoutNavigation";
import type { NavigationObstacle } from "@/domain/amr/navigation/layoutNavigation";
import {
  beltConnections,
  beltLength,
  beltPoint,
} from "@/domain/conveyor/conveyorLayout";
import type { SimulationRenderer } from "@/domain/simulation/SimulationRenderer";

type Cargo = {
  node: Group;
  belt: SceneEquipment;
  distance: number;
  state: "moving" | "reserved" | "held" | "placed" | "departing" | "passed";
  job?: Transfer;
  pallet?: string;
  attempted: Set<string>;
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
};
// Deterministic per-id starting charge so AMR cards differ but runs repeat.
const initialBattery = (id: string) => {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return AMR_BATTERY.initialMin + (hash % 1000) / 999 * (AMR_BATTERY.initialMax - AMR_BATTERY.initialMin);
};
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);
const palletGrade = (config: EquipmentSettings | undefined): CargoGrade =>
  config?.grade ?? "normal";
export class FactorySimulator {
  readonly root = new Group();
  readonly inspection: ScannerInspection;
  private scanFrom = new Vector3();
  private scanTo = new Vector3();
  readonly robots: FactoryRobot[] = [];
  readonly agents: FactoryAgent[] = [];
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
  private connections = new Map<string, SceneEquipment>();
  private incoming = new Set<string>();
  private instances?: SimulationRenderer;
  private rendered = new Set<Group>();
  private renderingActive = false;
  private random: () => number;
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
  constructor(
    objects: SceneEquipment[],
    box: Group,
    pallet: Group,
    getSettings: () => Record<string, EquipmentSettings>,
    instances?: SimulationRenderer,
    random: () => number = Math.random,
  ) {
    this.random = random;
    this.inspection = new ScannerInspection(getSettings, random);
    this.instances = instances;
    this.settings = getSettings;
    this.boxAsset = createUnitBox(box);
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
      if (object.kind === "amr")
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
    for (const robot of this.robots)
      this.palletOrder.set(
        robot.object.id,
        [...this.pallets].sort(
          (a, b) =>
            distance(robot.object, a.object) - distance(robot.object, b.object),
        ),
      );
  }
  private docks: SceneEquipment[] = [];
  private racks: SceneEquipment[] = [];
  /** Filled PalletPoints per rack; stored pallets stay for the rest of the run. */
  private rackStored = new Map<string, boolean[]>();
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
    node.userData.sceneId = belt.id;
    const item: Cargo = {
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
  private move(box: Cargo) {
    const point = beltPoint(
        box.belt,
        Math.min(box.distance, beltLength(box.belt)),
      ),
      s = Math.sin(point.yaw),
      c = Math.cos(point.yaw);
    box.node.position.set(point.x, 0.25 + BOX_SIZES[0].y, point.z);
    box.node.rotation.y = point.yaw;
    box.node.userData.sceneId = box.belt.id;
    if (box.job && box.state === "reserved") {
      box.job.pickup.copy(box.node.position);
      box.job
        .velocity!.set(s, 0, c)
        .multiplyScalar(
          beltSpeedOf(this.settings()[box.belt.id]),
        );
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
    for (const box of this.boxes) {
      if (box.state !== "moving" && box.state !== "reserved") continue;
      const config = settings[box.belt.id];
      let scanStart = box.distance;
      if (config.enabled)
        box.distance += dt * beltSpeedOf(config);
      // Reserved boxes stay on their segment until picked or released by the robot.
      for (
        let hops = 0;
        box.state === "moving" &&
        box.distance > beltLength(box.belt) &&
        hops < this.belts.length;
        hops++
      ) {
        const next = this.connections.get(box.belt.id);
        if (!next) break;
        if (!settings[next.id].enabled) {
          box.distance = beltLength(box.belt);
          break;
        }
        this.scanBeltTravel(box, scanStart, beltLength(box.belt));
        scanStart = 0;
        box.distance -= beltLength(box.belt);
        box.belt = next;
      }
      this.scanBeltTravel(box, scanStart, Math.min(box.distance, beltLength(box.belt)));
      this.move(box);
      if (box.distance > beltLength(box.belt) && box.state === "moving") {
        box.state = "passed";
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
      const reachable = new Set<CargoGrade>();
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
            box.distance > beltLength(box.belt) - 0.5 ||
            distance(robot.object, box.node.position) > config.reach - 0.05
          )
            continue;
          const speed = beltSpeedOf(settings[box.belt.id]);
          const predicted = beltPoint(
            box.belt,
            Math.min(
              beltLength(box.belt),
              box.distance + speed * MOTION.predictionSeconds,
            ),
          );
          this.point.set(predicted.x, box.node.position.y, predicted.z);
          if (distance(robot.object, this.point) > config.reach) continue;
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
      if (dispatch.phase === "returning")
        obstacles.push({ kind: "pallet", pose: navigation.layout.pallet });
      return layoutPath(
        navigation.layout,
        dispatch.carrier.position,
        goal,
        dispatch.radius === AMR_TRAFFIC.loadedRadius,
        obstacles,
      );
    });
    this.advanceBatteries(dt, settings);
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
    for (const shipment of [...this.shipments]) {
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
    for (const agent of this.agents)
      if (agent.dispatch.phase === "idle") {
        agent.waiting = false;
        agent.waitingReason = null;
      }
    const ready = this.pallets.filter(
      (pallet) =>
        !pallet.shipping &&
        settings[pallet.object.id].enabled &&
        pallet.full,
    );
    for (const pallet of ready) pallet.readyAt ??= this.elapsed;
    ready.sort((a, b) => a.readyAt! - b.readyAt!);
    for (const pallet of ready) {
      const agents = this.agents.filter(
        (a) => settings[a.object.id].enabled && a.dispatch.phase === "idle" && !a.charging,
      );
      if (!agents.length) break;
      // Prefer vehicles with fewer deliveries; randomize ties rather than reusing one vehicle forever.
      agents.sort((a, b) => a.completed - b.completed);
      const minimum = agents[0].completed;
      const start = Math.floor(
        this.random() * agents.filter((a) => a.completed === minimum).length,
      );
      for (let i = 0; i < agents.length; i++) {
        const agent = agents[(start + i) % agents.length];
        if (this.ship(pallet, agent)) break;
        agent.waiting = true;
      }
    }
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
    robot.busy = true;
    robot.status = "집기 준비";
    const job: Transfer = {
      box: box.node,
      pickup: box.node.position.clone(),
      destination: pallet.slots[slot].clone(),
      moving: true,
      yaw: pallet.object.yaw,
      velocity: new Vector3(),
      available: () =>
        box.state === "reserved" && box.distance < beltLength(box.belt),
      onPick: () => {
        box.state = "held";
      },
      onPlace: () => {
        box.state = "placed";
        box.pallet = pallet.object.id;
        pallet.place(slot, box.node, this.elapsed);
        this.placed++;
        robot.count++;
      },
      onMiss: () => {
        box.state = "moving";
        box.attempted.add(robot.object.id);
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
    const robot = [...this.robots].sort(
      (a, b) =>
        distance(a.object, pallet.object) - distance(b.object, pallet.object),
    )[0];
    const belt = [...this.belts].sort(
      (a, b) =>
        distance(a.object, pallet.object) - distance(b.object, pallet.object),
    )[0];
    const settings = this.settings(),
      grade = palletGrade(settings[pallet.object.id]);
    // Docks and racks are both outbound destinations.
    const accepting = [...this.docks, ...this.racks].filter((dock) => {
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
          ? `${grade === "defect" ? "불량" : "정상"} 팔레트를 받을 출고 구역이 없습니다.`
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
    };
    this.shipments.push(shipment);
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
          shipment.stored = true;
        } else group.position.y = 0;
        // Read yaw in YXZ so headings past ±90° don't decompose into X/Z flips.
        const yaw = new Euler().setFromQuaternion(group.quaternion, "YXZ").y;
        group.rotation.set(
          0,
          dock.yaw + (Math.PI / 2) * Math.round((yaw - dock.yaw) / (Math.PI / 2)),
          0,
        );
        shipment.dropped = shipment.slot === undefined;
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
    this.root.add(pallet.replace());
    this.render(pallet.group);
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
      pallets: this.pallets.map((pallet) => ({
        id: pallet.object.id,
        name: pallet.object.name,
        count: pallet.count,
        capacity: pallet.slots.length,
        shipping: pallet.shipping,
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
