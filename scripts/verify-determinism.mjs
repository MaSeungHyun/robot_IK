// Determinism check: node scripts/verify-determinism.mjs [seconds] [--templates=0,5,11] [--speeds=1,10]
// Runs each template headless at every speed for the same simulated time and compares a state hash
// (every node pose under the world root and robot models, plus counters). Exit code 1 on mismatch.
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const args = process.argv.slice(2);
const seconds = Number(args.find(a => !a.startsWith("--")) ?? 300);
const list = (name, fallback) => (args.find(a => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback).split(",").map(Number);
const templates = list("templates", "0,5,11"), speeds = list("speeds", "1,10");
globalThis.document ??= { cookie: "" };
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
let failed = false;
try {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  // Node has no image decoding: drop textures from the GLB JSON (geometry/hierarchy is all the sim needs).
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
  const fmt = (v) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6);
  const poses = (root, out) => root.traverse((o) => { out.push(o.name, o.visible ? 1 : 0, ...o.position.toArray().map(fmt), ...o.quaternion.toArray().map(fmt)); });
  for (const index of templates) {
    const template = SCENE_TEMPLATES[index];
    const hashes = [];
    for (const speed of speeds) {
      useSceneStore.getState().loadTemplate(template);
      const { objects, links } = useSceneStore.getState();
      const getSettings = () => useSceneStore.getState().settings;
      // No injected PRNG: exercises the simulator's own layout-seeded default (same as the app).
      const world = new FactorySimulator(objects, boxGltf.scene, palletGltf.scene, getSettings, undefined, undefined, links);
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
        // Same per-step driving as the app's robot participant.
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
      const state = [clock.stats.simTime.toFixed(6), world.stats.spawned, world.placed, world.passed, world.stats.completedPallets,
        ...[...world.inspection.sensors.values()].flatMap(s => [s.snapshot.scanned, s.snapshot.faults]),
        ...models.flatMap(m => [m.controller.phase])];
      poses(world.root, state);
      for (const m of models) poses(m.model, state);
      const hash = createHash("sha256").update(state.join("|")).digest("hex").slice(0, 16);
      hashes.push(hash);
      console.log(`template ${String(index + 1).padStart(2, "0")} ${template.name ?? template.id ?? ""} · ${speed}x · ${seconds}s sim · ${(performance.now() - began).toFixed(0)}ms · spawned ${world.stats.spawned} placed ${world.placed} · hash ${hash}`);
    }
    const same = hashes.every(h => h === hashes[0]);
    if (!same) failed = true;
    console.log(`  => ${same ? "MATCH" : "MISMATCH"}`);
  }
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);