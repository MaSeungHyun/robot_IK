// Headless pick reproduction: node scripts/pick-sim.mjs [seconds] [speeds...] [--template=N]
import { createServer } from "vite";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const seconds = Number(args.find(a => !a.startsWith("--") ) ?? 60);
const speeds = args.filter(a => !a.startsWith("--")).slice(1).map(Number);
const templateIndex = Number((args.find(a => a.startsWith("--template=")) ?? "--template=0").split("=")[1]);
const verbose = args.includes("--verbose");
globalThis.document ??= { cookie: "" };
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
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
  const [robotGltf, boxGltf, palletGltf, scannerGltf] = await Promise.all(["robot", "box", "pallet", "scanner"].map(n => parse(`src/assets/models/${n}.glb`)));
  const { SCENE_TEMPLATES } = await load("/src/constants/sceneTemplates.ts");
  const { useSceneStore } = await load("/src/stores/useSceneStore.ts");
  const { FactorySimulator } = await load("/src/domain/simulation/FactorySimulator.ts");
  const { SuctionRobotController } = await load("/src/domain/robot/SuctionRobotController.ts");
  const { SimulationClock } = await load("/src/domain/simulation/simulationClock.ts");
  const { SIMULATOR_CONFIG } = await load("/src/constants/simulatorLayout.ts");
  const { geometryAtScale } = await load("/src/lib/three/geometryAtScale.ts");
  const { createScannerModel } = await load("/src/objects/scanner/scannerModel.ts");
  const scannerModel = createScannerModel(scannerGltf.scene);
  const template = SCENE_TEMPLATES[templateIndex];
  const defectArg = process.argv.find(a => a.startsWith("--defect="));
  const runs = +(process.argv.find(a => a.startsWith("--runs="))?.slice(7) ?? 1);
  // --rack-slots=N keeps only the first N rack slots (fills racks quickly for rack-assignment checks).
  const rackSlotsArg = args.find(a => a.startsWith('--rack-slots='));
  if (rackSlotsArg) { const { RACK_CONFIG } = await load('/src/constants/rack.ts'); RACK_CONFIG.slots = RACK_CONFIG.slots.slice(0, +rackSlotsArg.split('=')[1]); }
  for (const speed of (speeds.length ? speeds : [1, 4, 8]).flatMap(v => Array(runs).fill(v))) {
    useSceneStore.getState().loadTemplate(template);
    // --defect=R forces every scanner's defect rate (e.g. 0 removes ScannerInspection randomness).
    if (defectArg) { const rate = +defectArg.slice(9); const st = useSceneStore.getState();
      useSceneStore.setState({ settings: Object.fromEntries(Object.entries(st.settings).map(([id, v]) => [id, { ...v, defectRate: rate }])) }); }
    // --rack-amr adds an east-wall door and a rack-unloading AMR (amrRole "rack") to check rack pallet outfeed.
    if (args.includes('--rack-amr')) { const st = useSceneStore.getState();
      st.add('door', { x: 10.5, z: 10, yaw: -Math.PI / 2 }); st.add('amr', { x: 8, z: 8, yaw: 0 });
      const after = useSceneStore.getState(), door = after.objects.filter(o => o.kind === 'door').at(-1), amr = after.objects.filter(o => o.kind === 'amr').at(-1);
      useSceneStore.setState({ objects: after.objects.map(o => o.id === door.id ? { ...o, x: 10.5, z: 10, yaw: -Math.PI / 2 } : o.id === amr.id ? { ...o, x: 8, z: 8, yaw: 0 } : o),
        settings: { ...after.settings, [amr.id]: { ...after.settings[amr.id], amrRole: 'rack' } } }); }
    const { objects, links } = useSceneStore.getState();
    const getSettings = () => useSceneStore.getState().settings;
    let seed = 12345; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const world = new FactorySimulator(objects, boxGltf.scene, palletGltf.scene, getSettings, undefined, random, links);
    const scene = new THREE.Scene(); scene.add(world.root);
    // Same sensor registration as objects/scanner/Scanner.tsx (React-only in the app).
    for (const entity of objects.filter(o => o.kind === "scanner")) {
      const point = scannerModel.localPoint.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.yaw); point.x += entity.x; point.z += entity.z;
      world.inspection.register(entity.id, { point, normal: new THREE.Vector3(Math.sin(entity.yaw), 0, Math.cos(entity.yaw)), halfWidth: scannerModel.halfWidth, floor: 0 });
    }
    const clock = new SimulationClock();
    const robots = world.robots.map((robot) => {
      const scale = SIMULATOR_CONFIG.robotScale, model = robotGltf.scene.clone(true);
      if (scale !== 1) model.traverse((node) => { node.position.multiplyScalar(scale); if (node.geometry) node.geometry = geometryAtScale(node.geometry, scale); });
      const holder = new THREE.Group(); holder.position.set(robot.object.x, 0, robot.object.z); holder.rotation.y = robot.object.yaw;
      holder.add(model); scene.add(holder); scene.updateMatrixWorld(true);
      const log = [];
      const controller = new SuctionRobotController({ id: robot.object.id, model, geometryScale: scale, pickupRadius: SIMULATOR_CONFIG.reach,
        getJobs: () => robot.jobs, onProgress: (count, status) => { world.robotProgress(robot, count, status); log.push(status); } });
      controller.start();
      const ik = controller.ik, original = ik.solveTrack;
      const nulls = [];
      ik.solveTrack = (target, lock) => {
        const result = original(target, lock);
        if (!result && nulls.length < 5) {
          const analytic = ik.lastTrackMiss;
          nulls.push({ phase: controller.phase, target: target.toArray().map(v => +v.toFixed(3)), lock: { front: lock.front, elbow: lock.elbow, pitch: +lock.origin.toFixed(3), maxReach: lock.maxReach },
            grip: ik.grip.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)), solutions: analytic });
        }
        return result;
      };
      const animate = ik.animate;
      ik.animate = (pose, dt) => { const ok = animate(pose, dt); if (!ok && nulls.length < 5 && ["GRASP","ATTACH"].includes(controller.phase)) nulls.push({ phase: controller.phase, animateBlocked: ik.lastMotionBlock }); return ok; };
      const enabled = () => getSettings()[robot.object.id]?.enabled !== false;
      let lastPhase = "", simTime = 0;
      const info = { nulls, id: robot.object.id, controller, transitions: [], log, grasp: [], phaseTime: {} };
      clock.register({
        beginFrame: (key) => { if (enabled()) controller.start(); else controller.pause(); void key; },
        step: (dt) => {
          let remaining = dt * (getSettings()[robot.object.id]?.speed ?? 1);
          if (remaining <= 0) { controller.update(0); return; }
          while (remaining > 1e-9) { const s = Math.min(remaining, 0.05); controller.update(s); remaining -= s; simTime += s; }
          const phase = controller.phase; info.phaseTime[phase] = (info.phaseTime[phase] ?? 0) + dt;
          const job = robot.jobs[controller.runtime?.index ?? 0];
          if (phase !== lastPhase) { info.transitions.push(`${simTime.toFixed(2)} ${lastPhase}->${phase}`); lastPhase = phase; }
          if ((phase === "GRASP" || phase === "ATTACH") && job) {
            const grip = controller.ik.grip.getWorldPosition(new THREE.Vector3()), box = job.box.getWorldPosition(new THREE.Vector3());
            info.grasp.push({ t: simTime, phase, d: grip.distanceTo(job.pickup), dxz: Math.hypot(grip.x - job.pickup.x, grip.z - job.pickup.z), dy: grip.y - job.pickup.y, boxY: box.y, top: new THREE.Box3().setFromObject(job.box).max.y, bottom: new THREE.Box3().setFromObject(job.box).min.y, gy: grip.y, lock: controller.runtime.lineLock === false ? "planner" : "track" });
          }
        },
        endFrame: () => {},
      });
      return info;
    });
    // Frames of 1/60 s real time at this speed, unlimited wall budget: run exactly `seconds` of sim time.
    const began = performance.now();
    let frames = 0;
    while (clock.stats.simTime < seconds - 1e-9) { clock.frame(1 / 60, speed, world, Infinity); frames++; }
    const realMs = performance.now() - began, steps = Math.round(clock.stats.simTime * 60), perStep = realMs / steps;
    // Browser estimate: 10 ms stepping per 60 Hz frame, one step = 1/60 s sim => capacity speed = 10 / ms-per-step.
    console.log(`\n=== speed ${speed}x · ${clock.stats.simTime.toFixed(0)}s sim · ${frames} frames · ${realMs.toFixed(0)}ms CPU · ${perStep.toFixed(3)}ms/step · est. browser max ~${(10 / perStep).toFixed(0)}x`);
    const sensors = [...world.inspection.sensors.values()].map(x => x.snapshot), scanned = sensors.reduce((a, x) => a + x.scanned, 0), faults = sensors.reduce((a, x) => a + x.faults, 0);
    console.log(`spawned ${world.stats.spawned} scanned ${scanned} ok ${scanned - faults} rejected ${faults} placed ${world.placed} passed ${world.passed}`);
    if (world.rackStored?.size) console.log('   racks:', [...world.rackStored].map(([id, s]) => id + ' ' + s.filter(Boolean).length + '/' + s.length).join(' | '), '· agents:', world.agents.map((a) => a.object.id + ':' + a.dispatch.phase + (a.waitingReason ? '(' + a.waitingReason + ')' : '')).join(' '));
    if (world.rackAgents?.length) console.log('   rackAMR:', world.rackAgents.map((a) => a.object.id + ':' + (a.controller.stage ?? 'idle') + ' done=' + a.controller.completed + (a.waitingReason ? '(' + a.waitingReason + ')' : '')).join(' '), '· unloaded:', world.unloaded);
    for (const p of world.pallets) { const per = Array.from({ length: p.layers }, (_, l) => p.states.filter((st, i) => st === "placed" && p.layerOf(i) === l).length);
      console.log(`   pallet ${p.object.id}: ${p.count}/${p.slots.length} (${p.layers} layers x ${p.perLayer}) per layer [${per.join(", ")}] shipped ${world.stats.completedPallets}`); }
    for (const r of robots) {
      const counts = {}; for (const s of r.log) { const k = s.split(" · ").slice(0, 2).join(" · "); counts[k] = (counts[k] ?? 0) + 1; }
      console.log(`-- ${r.id}: phaseTime`, Object.fromEntries(Object.entries(r.phaseTime).map(([k, v]) => [k, +v.toFixed(1)])));
      console.log("   transitions:", r.transitions.slice(0, verbose ? 200 : 30).join(" | "));
      console.log("   progress messages:", counts);
      if (r.nulls.length) console.log("   solveTrack null:", JSON.stringify(r.nulls.slice(0, 2)));
      const g = r.grasp; if (g.length) {
        const last = g.slice(-6).map(x => `${x.phase} d=${(x.d*1000).toFixed(0)}mm xz=${(x.dxz*1000).toFixed(0)} dy=${(x.dy*1000).toFixed(0)} ${x.lock}`);
        console.log("   grasp samples (last):", last.join(" ; "));
        const a = g.filter(x => x.phase === "ATTACH").at(-1); if (a) console.log(`   at ATTACH: gripY ${a.gy.toFixed(3)} boxTop ${a.top.toFixed(3)} boxBottom ${a.bottom.toFixed(3)} boxOrigin ${a.boxY.toFixed(3)} (grip - top = ${((a.gy-a.top)*1000).toFixed(0)}mm)`);
        const min = g.reduce((m, x) => Math.min(m, x.d), Infinity); console.log(`   min grip-pickup ${(min*1000).toFixed(1)}mm`);
      }
    }
  }
} finally { await server.close(); }
