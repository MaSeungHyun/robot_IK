/**
 * Deterministic headless run of one SceneTemplate (same setup as scripts/pick-sim.mjs): loads it through
 * useSceneStore.loadTemplate (the app's own validation), steps FactorySimulator + one SuctionRobotController
 * per robot on a SimulationClock, and measures steady-state metrics after a warm-up.
 * Runs in Node (vite ssrLoadModule) and in a Web Worker (no DOM, no React). Each JS context has its own store.
 */
import { Group, Scene, Vector3 } from "three";
import { useSceneStore } from "@/stores/useSceneStore";
import { FactorySimulator } from "@/domain/simulation/FactorySimulator";
import { SuctionRobotController } from "@/domain/robot/SuctionRobotController";
import { conveyorKeepOut } from "@/domain/robot/ik/keepOut";
import { SimulationClock } from "@/domain/simulation/simulationClock";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import type { SceneTemplate } from "@/types/sceneTemplate";
import type { SimMetrics } from "@/domain/layout/autoLayout";
import { robotElevation } from "@/domain/layout/robotPedestals";
import { SimRecorder } from "@/domain/recording/SimRecorder";
import type { SimRecording } from "@/domain/recording/simRecording";
import { createScannerModel } from "@/objects/scanner/scannerModel";

/** `scanner` (ScanTunnel.glb scene, optional): registers every scanner with the inspection like the viewer's Scanner.tsx, so scans run headless. */
export type SimModels = { robot: Group; box: Group; pallet: Group; scanner?: Group };
export type SimOptions = { seconds: number; warmup: number; seed?: number; /** Collect a SimRecording (suction, box parents, keyframes, pallets). */ record?: boolean; /** Legacy: mount arms at y=0 instead of on their pedestal (comparison only). */ floorMount?: boolean; /** Called after every frame (exporters sample world state here; read-only). */ onFrame?: (t: number, ctx: SimFrameContext) => void };
export type SimFrameContext = { world: FactorySimulator; scene: Scene; controllers: SuctionRobotController[]; holders: Group[]; recorder: SimRecorder | null; objects: ReturnType<typeof useSceneStore.getState>["objects"] };
export type SimResult = (SimMetrics & { shipped: number; cpuMs: number; /** Pallets the forklift took out of racks through the door. */ rackUnloaded: number; recording?: SimRecording }) | { error: string };

export function simulateTemplate(template: SceneTemplate, models: SimModels, { seconds, warmup, seed = 12345, record = false, floorMount = false, onFrame }: SimOptions): SimResult {
  const store = useSceneStore.getState();
  if (!store.editing) store.edit();
  if (!useSceneStore.getState().loadTemplate(template)) return { error: useSceneStore.getState().errors.join("; ") || "loadTemplate rejected" };
  const { objects, links, autoConnect, props } = useSceneStore.getState();
  if (links.length !== (template.links ?? []).length) return { error: `links dropped ${(template.links ?? []).length - links.length}` };
  const getSettings = () => useSceneStore.getState().settings;
  let state = seed;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const world = new FactorySimulator(objects, models.box, models.pallet, getSettings, undefined, random, links, autoConnect, props);
  const scene = new Scene();
  scene.add(world.root);
  if (models.scanner) for (const o of objects) if (o.kind === "scanner") {
    // Same sensor as Scanner.tsx: model scan point rotated by yaw, normal along the scanner heading.
    const sm = createScannerModel(models.scanner), point = sm.localPoint.clone().applyAxisAngle(new Vector3(0, 1, 0), o.yaw);
    point.x += o.x; point.z += o.z;
    world.inspection.register(o.id, { point, normal: new Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw)), halfWidth: sm.halfWidth, floor: 0 });
  }
  const clock = new SimulationClock();
  const rec = record ? new SimRecorder(scene, world.cargo, { template: template.id ?? template.name, seed, seconds },
    { objectKind: (id) => objects.find((o) => o.id === id)?.kind, railOf: (g) => world.railHolderOf(g),
      stationGroup: (id) => world.pallets.find((p) => p.object.id === id)?.group }) : null;
  const controllers: SuctionRobotController[] = [];
  const holders: Group[] = [];
  for (const robot of world.robots) {
    const model = models.robot.clone(true);
    const holder = new Group();
    // Same mount height as the viewer (FactoryArm): arm stands on its pedestal.
    const elevation = floorMount ? 0 : robotElevation(robot.object, getSettings()[robot.object.id]?.robotPedestal);
    holder.position.set(robot.object.x, elevation, robot.object.z); holder.rotation.y = robot.object.yaw;
    holder.add(model); scene.add(holder); holders.push(holder); rec?.markArm(holder, robot.object.id); scene.updateMatrixWorld(true);
    const controller = new SuctionRobotController({ id: robot.object.id, model, pickupRadius: SIMULATOR_CONFIG.reach, getKeepOut: () => conveyorKeepOut(objects),
      getJobs: () => robot.jobs, onProgress: (count, status) => world.robotProgress(robot, count, status),
      onSuction: rec ? (on, box, tool) => rec.suction(clock.stats.simTime, robot.object.id, on, box, tool) : undefined });
    controller.start();
    controllers.push(controller);
    clock.register({
      beginFrame: () => {},
      step: (dt) => { let remaining = dt; while (remaining > 1e-9) { const s = Math.min(remaining, 0.05); controller.update(s); remaining -= s; } },
      endFrame: () => {},
    });
  }
  const began = performance.now();
  let fullSeconds = 0, last = 0;
  let base: { placed: number; passed: number; busy: number[] } | null = null;
  while (clock.stats.simTime < seconds - 1e-9) {
    clock.frame(1 / 60, 1, world, Infinity);
    rec?.frame(clock.stats.simTime);
    onFrame?.(clock.stats.simTime, { world, scene, controllers, holders, recorder: rec, objects });
    const dt = clock.stats.simTime - last; last = clock.stats.simTime;
    if (base) fullSeconds += dt * world.pallets.filter((p) => p.full).length;
    if (!base && clock.stats.simTime >= warmup) base = { placed: world.placed, passed: world.passed, busy: world.robots.map((r) => r.busySeconds) };
  }
  const shipped = world.stats.completedPallets ?? 0;
  const rackUnloaded = world.unloaded;
  for (const controller of controllers) controller.dispose();
  world.dispose();
  const b = base ?? { placed: 0, passed: 0, busy: world.robots.map(() => 0) };
  const span = Math.max(1, seconds - warmup), perHour = (n: number) => Math.round((n * 3600) / span);
  return {
    placedPerHour: perHour(world.placed - b.placed), passedPerHour: perHour(world.passed - b.passed),
    palletWaitShare: +(fullSeconds / span / Math.max(1, world.pallets.length)).toFixed(3),
    robotUtilization: +(world.robots.reduce((s, r, i) => s + (r.busySeconds - b.busy[i]), 0) / span / Math.max(1, world.robots.length)).toFixed(3),
    shipped,
    rackUnloaded,
    cpuMs: Math.round(performance.now() - began),
    ...(rec ? { recording: rec.data } : {}),
  };
}
