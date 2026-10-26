// Shared headless simulation harness (node): vite SSR loads the app modules, GLBs are parsed without textures.
// openHarness() -> { run(templateIndex, seconds, speed, { kpi }) -> { world, models, clock, template, ms }, close() }.
import { createServer } from "vite";
import { readFileSync } from "node:fs";

export async function openHarness() {
  globalThis.document ??= { cookie: "" };
  globalThis.window ??= globalThis;
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
  const load = (p) => server.ssrLoadModule(p);
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const stripTextures = (glb) => {
    const jsonLength = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
    delete json.textures; delete json.images; delete json.samplers;
    for (const m of json.materials ?? []) {
      for (const k of Object.keys(m)) if (k.endsWith("Texture")) delete m[k];
      if (m.pbrMetallicRoughness) for (const k of Object.keys(m.pbrMetallicRoughness)) if (k.endsWith("Texture")) delete m.pbrMetallicRoughness[k];
      delete m.extensions;
    }
    json.extensionsUsed = (json.extensionsUsed ?? []).filter(e => !/texture|webp|basisu/i.test(e));
    json.extensionsRequired = (json.extensionsRequired ?? []).filter(e => !/texture|webp|basisu/i.test(e));
    let text = Buffer.from(JSON.stringify(json)); const pad = (4 - text.length % 4) % 4; text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
    const rest = glb.subarray(20 + jsonLength), header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + text.length + rest.length, 8);
    header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    return Buffer.concat([header, text, rest]);
  };
  const parse = (file) => new Promise((resolve, reject) => {
    const buffer = stripTextures(readFileSync(file));
    new GLTFLoader().parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "", resolve, reject);
  });
  const [robotGltf, boxGltf, palletGltf, scannerGltf] = await Promise.all(["RobotArm", "box", "pallet", "ScanTunnel"].map(n => parse(`src/assets/models_original/${n}.glb`)));
  const { SCENE_TEMPLATES } = await load("/src/constants/sceneTemplates.ts");
  const { useSceneStore } = await load("/src/stores/useSceneStore.ts");
  const { FactorySimulator } = await load("/src/domain/simulation/FactorySimulator.ts");
  const { SuctionRobotController } = await load("/src/domain/robot/SuctionRobotController.ts");
  const { SimulationClock } = await load("/src/domain/simulation/simulationClock.ts");
  const { SIMULATOR_CONFIG } = await load("/src/constants/simulatorLayout.ts");
  const { createScannerModel } = await load("/src/objects/scanner/scannerModel.ts");
  const scannerModel = createScannerModel(scannerGltf.scene);
  /** Runs one template headless for `seconds` of sim time at `speed` (1/60 s frames, unlimited wall budget). */
  function run(index, seconds, speed, options = {}) {
    const template = SCENE_TEMPLATES[index];
    if (!template) throw new Error(`no template ${index}`);
    useSceneStore.getState().loadTemplate(template);
    const { objects, links } = useSceneStore.getState();
    const getSettings = () => useSceneStore.getState().settings;
    // No injected PRNG: the simulator's own layout-seeded default (same as the app).
    const world = new FactorySimulator(objects, boxGltf.scene, palletGltf.scene, getSettings, undefined, undefined, links);
    if (options.kpi) world.kpi.configure(options.kpi);
    const scene = new THREE.Scene(); scene.add(world.root);
    for (const entity of objects.filter(o => o.kind === "scanner")) {
      const point = scannerModel.localPoint.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.yaw); point.x += entity.x; point.z += entity.z;
      world.inspection.register(entity.id, { point, normal: new THREE.Vector3(Math.sin(entity.yaw), 0, Math.cos(entity.yaw)), halfWidth: scannerModel.halfWidth, floor: 0 });
    }
    const clock = new SimulationClock();
    const models = world.robots.map((robot) => {
      const model = robotGltf.scene.clone(true);
      const holder = new THREE.Group(); holder.position.set(robot.object.x, 0, robot.object.z); holder.rotation.y = robot.object.yaw;
      holder.add(model); scene.add(holder); scene.updateMatrixWorld(true);
      const controller = new SuctionRobotController({ id: robot.object.id, model, pickupRadius: SIMULATOR_CONFIG.reach,
        getJobs: () => robot.jobs, onProgress: (count, status) => world.robotProgress(robot, count, status) });
      controller.start();
      const enabled = () => getSettings()[robot.object.id]?.enabled !== false;
      // Same per-step driving as the app's robot participant (Robot.tsx).
      clock.register({
        beginFrame: () => { if (enabled()) controller.start(); else controller.pause(); },
        step: (dt) => {
          let remaining = dt * (getSettings()[robot.object.id]?.speed ?? 1);
          if (remaining <= 0) { controller.update(0); return; }
          while (remaining > 1e-9) { const s = Math.min(remaining, 0.05); controller.update(s); remaining -= s; }
        },
        endFrame: () => {},
      });
      return { model, controller };
    });
    const began = performance.now();
    while (clock.stats.simTime < seconds - 1e-9) clock.frame(1 / 60, speed, world, Infinity);
    return { world, models, clock, template, ms: performance.now() - began };
  }
  return { run, close: () => server.close() };
}