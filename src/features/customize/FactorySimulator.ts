import { Group, Vector3 } from "three";
import type {
  SceneEquipment,
  EquipmentSettings,
  FactoryLayout,
} from "@/types/layout";
import type { Transfer } from "@/types/robot";
import type { StreamStats } from "@/types/conveyor";
import type { EquipmentSnapshot } from "@/types/simulation";
import { BOX_SIZES, STREAM_CONFIG, MOTION } from "@/constants/simulation";
import { DEFAULT_LAYOUT, AMR_TRAFFIC } from "@/constants/customize";
import {
  createUnitBox,
  createUnitPallet,
} from "@/utils/three/modelNormalization";
import { planStack } from "@/utils/packing/stacking";
import { PalletDispatchController } from "@/features/amr/PalletDispatchController";
import { AMRTrafficController } from "@/features/amr/AMRTrafficController";
import type { DispatchRoutes } from "@/features/amr/PalletDispatchController";
import { layoutPath, routeFailureReason } from "@/utils/amr/layoutNavigation";
import type { NavigationObstacle } from "@/utils/amr/layoutNavigation";
import {
  beltConnections,
  beltLength,
  beltPoint,
} from "@/utils/conveyor/conveyorLayout";
import type { SceneInstances } from "@/features/Viewport/instancing/SceneInstances";

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
type Pallet = {
  object: SceneEquipment;
  group: Group;
  slots: Vector3[];
  states: ("free" | "reserved" | "placed")[];
  count: number;
  shipping: boolean;
  readyAt: number | null;
};
export type FactoryAgent = {
  object: SceneEquipment;
  dispatch: PalletDispatchController;
  completed: number;
  waiting: boolean;
  waitingReason: string | null;
  target: string | null;
};
type Shipment = {
  pallet: Pallet;
  group: Group;
  cargo: Set<Cargo>;
  agent: FactoryAgent;
  replaced: boolean;
};
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);
const Y = new Vector3(0, 1, 0);
export class FactorySimulator {
  readonly root = new Group();
  readonly robots: FactoryRobot[] = [];
  readonly agents: FactoryAgent[] = [];
  readonly pallets: Pallet[] = [];
  readonly belts: { object: SceneEquipment; elapsed: number }[] = [];
  boxes: Cargo[] = [];
  spawned = 0;
  placed = 0;
  passed = 0;
  dispatched = 0;
  elapsed = 0;
  private boxAsset: Group;
  private palletAsset: Group;
  private settings: () => Record<string, EquipmentSettings>;
  private point = new Vector3();
  private palletOrder = new Map<string, Pallet[]>();
  private dispatchRetry = 0;
  private connections = new Map<string, SceneEquipment>();
  private incoming = new Set<string>();
  private instances?: SceneInstances;
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
    instances?: SceneInstances,
    random: () => number = Math.random,
  ) {
    this.random = random;
    this.instances = instances;
    this.settings = getSettings;
    this.boxAsset = createUnitBox(box);
    this.palletAsset = createUnitPallet(pallet);
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
        const slots = planStack(
          this.settings()[object.id].capacity,
          new Vector3(
            STREAM_CONFIG.palletWidth,
            STREAM_CONFIG.palletHeight,
            STREAM_CONFIG.palletDepth,
          ),
          BOX_SIZES[0],
          0,
        ).slots.map((slot) =>
          slot.position
            .clone()
            .add(new Vector3(0, STREAM_CONFIG.palletHeight + BOX_SIZES[0].y, 0))
            .applyAxisAngle(Y, object.yaw)
            .add(new Vector3(object.x, 0, object.z)),
        );
        const group = this.palletGroup(object);
        this.pallets.push({
          object,
          group,
          slots,
          states: slots.map(() => "free"),
          count: 0,
          shipping: false,
          readyAt: null,
        });
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
        });
    }
    this.trafficVehicles = this.agents.map((agent) => ({
      id: agent.object.id,
      dispatch: agent.dispatch,
      speed: 1,
      enabled: true,
    }));
    const connections = beltConnections(objects);
    this.connections = connections.next;
    this.incoming = connections.incoming;
    const visited = new Set<string>();
    const seed = (object: SceneEquipment) => {
      const chain: SceneEquipment[] = [];
      let current: SceneEquipment | undefined = object;
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        chain.push(current);
        current = this.connections.get(current.id);
      }
      if (chain.length === 1 || this.incoming.has(object.id)) {
        for (const distance of [0, 0.5, 1]) this.spawn(object, distance);
      } else {
        // Populate the whole connected line immediately, with one inlet feeding it continuously.
        const spacing = Math.max(
          BOX_SIZES[0].z + 0.08,
          STREAM_CONFIG.speed * this.settings()[object.id].spawnInterval,
        );
        let offset = 0;
        for (const segment of chain) {
          const length = beltLength(segment);
          while (offset < length) {
            this.spawn(segment, offset);
            offset += spacing;
          }
          offset -= length;
        }
      }
    };
    for (const belt of this.belts.filter(
      (belt) => !this.incoming.has(belt.object.id),
    ))
      seed(belt.object);
    // Closed loops have no inlet: seed once, then circulate existing boxes.
    for (const belt of this.belts)
      if (!visited.has(belt.object.id)) seed(belt.object);
    this.docks = objects.filter((o) => o.kind === "dock");
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
    if (this.renderingActive)
      for (const object of this.rendered) this.instances?.unregister(object);
    this.renderingActive = false;
  }
  private palletGroup(object: SceneEquipment) {
    const group = new Group(),
      model = this.palletAsset.clone(true);
    model.scale.set(
      STREAM_CONFIG.palletWidth,
      STREAM_CONFIG.palletHeight,
      STREAM_CONFIG.palletDepth,
    );
    group.add(model);
    group.position.set(object.x, 0, object.z);
    group.rotation.y = object.yaw;
    group.userData.sceneId = object.id;
    this.root.add(group);
    this.render(group);
    return group;
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
          STREAM_CONFIG.speed * this.settings()[box.belt.id].speed,
        );
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
      belt.elapsed += dt * config.speed;
      if (belt.elapsed >= config.spawnInterval) {
        const inletOccupied = this.boxes.some(
          (box) =>
            (box.state === "moving" || box.state === "reserved") &&
            box.belt.id === belt.object.id &&
            box.distance < BOX_SIZES[0].z + 0.08,
        );
        if (!inletOccupied) {
          belt.elapsed -= config.spawnInterval;
          this.spawn(belt.object);
        } else belt.elapsed = config.spawnInterval;
      }
    }
    let removed = false;
    for (const box of this.boxes) {
      if (box.state !== "moving" && box.state !== "reserved") continue;
      const config = settings[box.belt.id];
      if (config.enabled)
        box.distance += dt * STREAM_CONFIG.speed * config.speed;
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
        box.distance -= beltLength(box.belt);
        box.belt = next;
      }
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
      let assigned = false;
      for (const pallet of this.palletOrder.get(robot.object.id)!) {
        if (
          pallet.shipping ||
          !settings[pallet.object.id].enabled ||
          !pallet.states.includes("free")
        )
          continue;
        const slot = pallet.states.indexOf("free"),
          target = pallet.slots[slot];
        if (distance(robot.object, target) > config.reach) continue;
        for (const box of this.boxes) {
          if (
            box.state !== "moving" ||
            box.attempted.has(robot.object.id) ||
            box.distance > beltLength(box.belt) - 0.5 ||
            distance(robot.object, box.node.position) > config.reach - 0.05
          )
            continue;
          const speed = STREAM_CONFIG.speed * settings[box.belt.id].speed;
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
      vehicle.speed = settings[vehicle.id].speed;
      vehicle.enabled = settings[vehicle.id].enabled;
    }
    this.traffic.advance(this.trafficVehicles, dt, (vehicle) => {
      const navigation = this.navigation.get(vehicle.id);
      if (!navigation) return null;
      const dispatch = vehicle.dispatch,
        goal = dispatch.path[dispatch.path.length - 1];
      if (!goal) return null;
      const obstacles: NavigationObstacle[] = [
        ...navigation.obstacles,
        ...this.agents
          .filter((other) => other.object.id !== vehicle.id)
          .map((other) => ({
            kind: other.object.kind,
            pose: {
              x: other.dispatch.carrier.position.x,
              z: other.dispatch.carrier.position.z,
              yaw: 0,
            },
            radius: other.dispatch.radius + AMR_TRAFFIC.safetyMargin,
          })),
      ];
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
        pallet.count === pallet.slots.length,
    );
    for (const pallet of ready) pallet.readyAt ??= this.elapsed;
    ready.sort((a, b) => a.readyAt! - b.readyAt!);
    for (const pallet of ready) {
      const agents = this.agents.filter(
        (a) => settings[a.object.id].enabled && a.dispatch.phase === "idle",
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
  private assign(
    robot: FactoryRobot,
    pallet: Pallet,
    slot: number,
    box: Cargo,
  ) {
    box.state = "reserved";
    pallet.states[slot] = "reserved";
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
        pallet.group.attach(box.node);
        pallet.states[slot] = "placed";
        pallet.count++;
        if (pallet.count === pallet.slots.length) pallet.readyAt = this.elapsed;
        this.placed++;
        robot.count++;
      },
      onMiss: () => {
        box.state = "moving";
        box.attempted.add(robot.object.id);
        pallet.states[slot] = "free";
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
  private ship(pallet: Pallet, agent: FactoryAgent) {
    const robot = [...this.robots].sort(
      (a, b) =>
        distance(a.object, pallet.object) - distance(b.object, pallet.object),
    )[0];
    const belt = [...this.belts].sort(
      (a, b) =>
        distance(a.object, pallet.object) - distance(b.object, pallet.object),
    )[0];
    const docks = this.docks
      .filter((dock) => this.settings()[dock.id].enabled)
      .sort((a, b) => distance(a, pallet.object) - distance(b, pallet.object));
    if (!robot || !belt || !docks.length) {
      agent.waitingReason = "운반할 로봇·컨베이어·출고 구역을 확인해 주세요.";
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
    for (const dock of docks) {
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
      break;
    }
    if (!routes) return false;
    pallet.shipping = true;
    const shipment: Shipment = {
      pallet,
      agent,
      group: pallet.group,
      cargo: new Set(
        this.boxes.filter(
          (box) => box.pallet === pallet.object.id && box.state === "placed",
        ),
      ),
      replaced: false,
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
        this.unrender(shipment.group);
        for (const box of shipment.cargo) this.unrender(box.node);
        shipment.group.removeFromParent();
        shipment.group.clear();
        this.boxes = this.boxes.filter((box) => !shipment.cargo.has(box));
        this.replacePallet(shipment);
        this.shipments.splice(this.shipments.indexOf(shipment), 1);
        this.dispatched++;
        agent.completed++;
        agent.target = null;
      },
      routes,
    );
    return true;
  }
  private replacePallet(shipment: Shipment) {
    if (shipment.replaced) return;
    shipment.replaced = true;
    const pallet = shipment.pallet;
    pallet.group = this.palletGroup(pallet.object);
    pallet.states.fill("free");
    pallet.count = 0;
    pallet.shipping = false;
    pallet.readyAt = null;
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
  get equipment(): EquipmentSnapshot {
    const settings = this.settings();
    return {
      elapsed: this.elapsed,
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
          : agent.dispatch.yielding
            ? "yielding"
            : agent.waiting && agent.dispatch.phase === "idle"
              ? "waiting"
              : agent.dispatch.phase,
        status:
          agent.waiting && agent.dispatch.phase === "idle"
            ? (agent.waitingReason ?? "운반 가능한 안전 경로를 기다립니다.")
            : agent.dispatch.status,
        target: agent.target,
        completed: agent.completed,
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
