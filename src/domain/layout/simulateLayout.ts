/**
 * Deterministic headless run of one SceneTemplate (same setup as scripts/pick-sim.mjs): loads it through
 * useSceneStore.loadTemplate (the app's own validation), steps FactorySimulator + one SuctionRobotController
 * per robot on a SimulationClock, and measures steady-state metrics after a warm-up.
 * Runs in Node (vite ssrLoadModule) and in a Web Worker (no DOM, no React). Each JS context has its own store.
 */
import { Group, Scene } from "three";
import type { Mesh, Object3D } from "three";
import { useSceneStore } from "@/stores/useSceneStore";
import { FactorySimulator } from "@/domain/simulation/FactorySimulator";
import { SuctionRobotController } from "@/domain/robot/SuctionRobotController";
import { SimulationClock } from "@/domain/simulation/simulationClock";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { geometryAtScale } from "@/lib/three/geometryAtScale";
import type { SceneTemplate } from "@/types/sceneTemplate";
import type { SimMetrics } from "@/domain/layout/autoLayout";

export type SimModels = { robot: Group; box: Group; pallet: Group };
export type SimOptions = { seconds: number; warmup: number; seed?: number };
export type SimResult = (SimMetrics & { shipped: number; cpuMs: number; /** Pallets the rack AMR took out of racks through the door. */ rackUnloaded: number }) | { error: string };

export function simulateTemplate(template: SceneTemplate, models: SimModels, { seconds, warmup, seed = 12345 }: SimOptions): SimResult {
  const store = useSceneStore.getState();
  if (!store.editing) store.edit();
  if (!useSceneStore.getState().loadTemplate(template)) return { error: useSceneStore.getState().errors.join("; ") || "loadTemplate rejected" };
  const { objects, links } = useSceneStore.getState();
  if (links.length !== (template.links ?? []).length) return { error: `links dropped ${(template.links ?? []).length - links.length}` };
  const getSettings = () => useSceneStore.getState().settings;
  let state = seed;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const world = new FactorySimulator(objects, models.box, models.pallet, getSettings, undefined, random, links);
  const scene = new Scene();
  scene.add(world.root);
  const clock = new SimulationClock();
  const controllers: SuctionRobotController[] = [];
  for (const robot of world.robots) {
    const scale = SIMULATOR_CONFIG.robotScale, model = models.robot.clone(true);
    if (scale !== 1) model.traverse((node: Object3D) => {
      node.position.multiplyScalar(scale);
      const mesh = node as Mesh;
      if (mesh.geometry) mesh.geometry = geometryAtScale(mesh.geometry, scale);
    });
    const holder = new Group();
    holder.position.set(robot.object.x, 0, robot.object.z); holder.rotation.y = robot.object.yaw;
    holder.add(model); scene.add(holder); scene.updateMatrixWorld(true);
    const controller = new SuctionRobotController({ id: robot.object.id, model, geometryScale: scale, pickupRadius: SIMULATOR_CONFIG.reach,
      getJobs: () => robot.jobs, onProgress: (count, status) => world.robotProgress(robot, count, status) });
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
  };
}
