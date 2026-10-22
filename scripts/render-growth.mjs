// Render growth probe: node scripts/render-growth.mjs [--template=N | --file=path.json] [--hours=3] [--every=600]
// Runs the deterministic sim headless with a real SceneInstances and samples, every `every` sim seconds:
// instanced batches (? draw calls of the main pass), instance count and triangles (count x geometry tris),
// cargo objects in the scene graph, rendered owners, stored/shipped pallets, JS heap.
import { createServer } from "vite";
import { readFileSync } from "node:fs";
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
globalThis.document ??= { cookie: "" }; globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
try {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { stripGlbTextures } = await load("/src/domain/layout/stripGlbTextures.ts");
  const parse = async (n) => { const f = readFileSync(`src/assets/models/${n}.glb`); return (await new GLTFLoader().parseAsync(stripGlbTextures(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength)), "")).scene; };
  const [robotModel, boxModel, palletModel] = await Promise.all(["robot", "box", "pallet"].map(parse));
  const { SCENE_TEMPLATES } = await load("/src/constants/sceneTemplates.ts");
  const { useSceneStore } = await load("/src/stores/useSceneStore.ts");
  const { FactorySimulator } = await load("/src/domain/simulation/FactorySimulator.ts");
  const { SuctionRobotController } = await load("/src/domain/robot/SuctionRobotController.ts");
  const { SimulationClock } = await load("/src/domain/simulation/simulationClock.ts");
  const { SIMULATOR_CONFIG } = await load("/src/constants/simulatorLayout.ts");
  const { geometryAtScale } = await load("/src/lib/three/geometryAtScale.ts");
  const { SceneInstances } = await load("/src/viewport/instancing/SceneInstances.ts");
  const file = arg("file");
  const template = file ? JSON.parse(readFileSync(file, "utf8")) : SCENE_TEMPLATES[+arg("template", 0)];
  if (!useSceneStore.getState().loadTemplate(template)) throw new Error(useSceneStore.getState().errors.join("; "));
  const { objects, links } = useSceneStore.getState();
  const getSettings = () => useSceneStore.getState().settings;
  let seed = 12345; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const instances = new SceneInstances();
  const world = new FactorySimulator(objects, boxModel, palletModel, getSettings, instances, random, links);
  const scene = new THREE.Scene(); scene.add(world.root); scene.add(instances.root);
  world.connectInstances();
  const clock = new SimulationClock();
  for (const robot of world.robots) {
    const scale = SIMULATOR_CONFIG.robotScale, model = robotModel.clone(true);
    model.traverse((node) => { node.position.multiplyScalar(scale); if (node.geometry) node.geometry = geometryAtScale(node.geometry, scale); });
    const holder = new THREE.Group(); holder.position.set(robot.object.x, 0, robot.object.z); holder.rotation.y = robot.object.yaw; holder.add(model); scene.add(holder); scene.updateMatrixWorld(true);
    const controller = new SuctionRobotController({ id: robot.object.id, model, geometryScale: scale, pickupRadius: SIMULATOR_CONFIG.reach, getJobs: () => robot.jobs, onProgress: (c, s) => world.robotProgress(robot, c, s) });
    controller.start();
    clock.register({ beginFrame() {}, step(dt) { let r = dt; while (r > 1e-9) { const s = Math.min(r, 0.05); controller.update(s); r -= s; } }, endFrame() {} });
  }
  const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  const sample = () => {
    instances.sync();
    let batches = 0, count = 0, triangles = 0, capacity = 0, boxTris = 0, boxCount = 0, boxBatches = 0, gpuBytes = 0;
    for (const b of instances.batches.values()) {
      if (!b.mesh || !b.mesh.count) continue;
      batches++; count += b.mesh.count; capacity += b.capacity; triangles += b.mesh.count * tris(b.geometry); gpuBytes += b.capacity * 64;
      if (!b.castShadow && b.ordered[0]?.owner.userData.cargo) { boxBatches++; boxCount += b.mesh.count; boxTris += b.mesh.count * tris(b.geometry); }
    }
    let cargoNodes = 0, objects3d = 0; scene.traverse((n) => { objects3d++; if (n.userData.cargo) cargoNodes++; });
    const stored = [...(world.rackStored?.values() ?? [])].reduce((s, a) => s + a.filter(Boolean).length, 0);
    const casters = [...instances.batches.values()].filter((b) => b.mesh?.count && b.castShadow).length;
    return { t: Math.round(clock.stats.simTime), shipped: world.stats.completedPallets, stored, placed: world.placed, liveBoxes: world.boxes.length, cargoNodes, objects3d,
      batches, casters, instances: count, capacity, triangles, boxBatches, boxInstances: boxCount, boxTris, instanceKB: Math.round(gpuBytes / 1024), heapMB: Math.round(process.memoryUsage().heapUsed / 1048576) };
  };
  const hours = +arg("hours", 3), every = +arg("every", 600);
  const rows = [sample()];
  while (clock.stats.simTime < hours * 3600 - 1e-9) { clock.frame(1 / 60, 1, world, Infinity); if (clock.stats.simTime >= rows.length * every) rows.push(sample()); }
  const boxGeometries = []; boxModel.traverse((n) => n.geometry && boxGeometries.push(tris(n.geometry)));
  console.log(`template ${template.id} ? box.glb meshes ${boxGeometries.length} tris ${boxGeometries.join("+")}`);
  console.log(Object.keys(rows[0]).join("\t"));
  for (const r of rows) console.log(Object.values(r).join("\t"));
} finally { await server.close(); }
