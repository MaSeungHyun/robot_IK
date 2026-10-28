// Headless template flow check with robot arms: node scripts/flow-check.mjs [--template=0,2] [--file=x.json] [--at=300,600] [--speed=8]
import { createServer } from "vite";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const seconds = Number(args.find(a => !a.startsWith("--") ) ?? 60);
const speeds = args.filter(a => !a.startsWith("--")).slice(1).map(Number);
const templateIndex = Number((args.find(a => a.startsWith("--template=")) ?? "--template=0").split("=")[1]);
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
  const [robotGltf, boxGltf, palletGltf, scannerGltf] = await Promise.all(["RobotArm", "box", "pallet", "ScanTunnel"].map(n => parse(`src/assets/models_original/${n}.glb`)));
  const { SCENE_TEMPLATES } = await load("/src/constants/sceneTemplates.ts");
  const { useSceneStore } = await load("/src/stores/useSceneStore.ts");
  const { FactorySimulator } = await load("/src/domain/simulation/FactorySimulator.ts");
  const { SuctionRobotController } = await load("/src/domain/robot/SuctionRobotController.ts");
const { conveyorKeepOut } = await load("/src/domain/robot/ik/keepOut.ts");
  const { SimulationClock } = await load("/src/domain/simulation/simulationClock.ts");
  const { SIMULATOR_CONFIG } = await load("/src/constants/simulatorLayout.ts");
  const { createScannerModel } = await load("/src/objects/scanner/scannerModel.ts");
  const { validateScene } = await load("/src/domain/amr/navigation/sceneValidation.ts");
  const scannerModel = createScannerModel(scannerGltf.scene);
  const checkpoints = (args.find(a => a.startsWith("--at=")) ?? "--at=300,600").slice(5).split(",").map(Number);
  const speed = +(args.find(a => a.startsWith("--speed=")) ?? "--speed=8").slice(8);
  const only = args.find(a => a.startsWith("--template="));
  const fileArg = args.find(a => a.startsWith("--file="));
  const list = fileArg ? [JSON.parse(readFileSync(fileArg.slice(7), "utf8"))] : only ? only.slice(11).split(",").map(i => SCENE_TEMPLATES[+i]) : SCENE_TEMPLATES;
  for (const template of list) {
    useSceneStore.getState().loadTemplate(template);
    const autoArg = args.find(a => a.startsWith("--auto="));
    if (autoArg) useSceneStore.setState({ autoConnect: autoArg.slice(7) !== "off" });
    const { objects, links, autoConnect } = useSceneStore.getState();
    const getSettings = () => useSceneStore.getState().settings;
    const errors = validateScene(objects, getSettings());
    console.log(`## ${template.id} (${template.name}) validation: ${errors.length ? errors.join(" | ") : "ok"}`);
    let seed = 12345; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const buildStart = performance.now();
    const world = new FactorySimulator(objects, boxGltf.scene, palletGltf.scene, getSettings, undefined, random, links, autoConnect);
    const buildMs = performance.now() - buildStart;
    const scene = new THREE.Scene(); scene.add(world.root);
    for (const entity of objects.filter(o => o.kind === "scanner")) {
      const point = scannerModel.localPoint.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.yaw); point.x += entity.x; point.z += entity.z;
      world.inspection.register(entity.id, { point, normal: new THREE.Vector3(Math.sin(entity.yaw), 0, Math.cos(entity.yaw)), halfWidth: scannerModel.halfWidth, floor: 0 });
    }
    // Play render coverage: every AMR must be drawn by FactoryRun (agents, forkliftAgents or cycle.views).
    const drawn = new Set([...world.agents.map((a) => a.object.id), ...world.forkliftAgents.map((a) => a.object.id), ...(world.cycle?.views ?? []).map((v) => v.id)]);
    const hidden = objects.filter((o) => o.kind === "amr" && !drawn.has(o.id)).map((o) => o.id);
    console.log(`  render: amr ${objects.filter((o) => o.kind === "amr").length} drawn ${drawn.size}${hidden.length ? " HIDDEN " + hidden.join(",") : ""}`);
    const clock = new SimulationClock();
    for (const robot of world.robots) {
      const model = robotGltf.scene.clone(true);
      const holder = new THREE.Group(); holder.position.set(robot.object.x, robot.object.elevation ?? 0, robot.object.z); holder.rotation.y = robot.object.yaw;
      holder.add(model); scene.add(holder); scene.updateMatrixWorld(true);
      const controller = new SuctionRobotController({ id: robot.object.id, model, pickupRadius: SIMULATOR_CONFIG.reach, getKeepOut: () => conveyorKeepOut(useSceneStore.getState().objects),
        getJobs: () => robot.jobs, onProgress: (count, status) => world.robotProgress(robot, count, status) });
      controller.start();
      clock.register({ beginFrame: () => controller.start(), step: (dt) => { let r = dt * (getSettings()[robot.object.id]?.speed ?? 1); // mirrors Robot.tsx simulationSpeed
      while (r > 1e-9) { const s = Math.min(r, 0.05); controller.update(s); r -= s; } }, endFrame: () => {} });
    }
    // Stall sampling: an AMR in a driving phase that has not moved 5 cm in a 1 s sample counts as a stalled second.
    const last = new Map(), stalled = new Map(), beltHalt = new Map(), phaseTime = new Map(), haltedSec = { n: 0, streak: 0, max: 0 };
    let next = 1;
    // STEP_PROF=1: per-step wall time of the simulation (a single long step is a visible UI freeze).
    const prof = process.env.STEP_PROF ? { steps: [], parts: new Map() } : null;
    if (prof) {
      const wrap = (obj, name, label) => { if (typeof obj?.[name] !== "function") return; const f = obj[name].bind(obj); obj[name] = (...a) => { const t = performance.now(); try { return f(...a); } finally { const e = performance.now() - t, p = prof.parts.get(label) ?? { total: 0, max: 0 }; p.total += e; p.max = Math.max(p.max, e); prof.parts.set(label, p); } }; };
      const proto = Object.getPrototypeOf(world);
      for (const name of Object.getOwnPropertyNames(proto)) if (/^(advance\w+|dispatch\w*|plan\w*|route\w*|assignRobots|replan\w*)$/.test(name) && typeof world[name] === "function" && name !== "advance") wrap(world, name, name);
      wrap(world.traffic, "advance", "traffic.advance");
      wrap(world.cycle, "advance", "cycle.advance");
      if (world.cycle) for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(world.cycle))) if (name !== "advance" && name !== "constructor" && typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(world.cycle), name).value === "function") wrap(world.cycle, name, "cycle." + name);
      for (const name of ["route", "plan", "replan", "path", "findPath", "advance"]) for (const v of world.cycle?.views ?? []) wrap(v.vehicle, name, "veh." + name);
      const adv = world.advance.bind(world);
      world.advance = (dt) => { const t = performance.now(); adv(dt); prof.steps.push(performance.now() - t); };
    }
    { const t0 = performance.now(); clock.frame(1 / 60, speed, world, Infinity); console.log(`  startup: build ${buildMs.toFixed(0)}ms firstFrame ${(performance.now() - t0).toFixed(0)}ms`); }
    const minGap = { d: Infinity, pair: "", t: 0, limit: 0 };
    // One AMR per dock: never two AMR bodies inside one dock's footprint (pallet pose + body radius) at once.
    const dockPoses = objects.filter((o) => o.kind === "dock");
    const dockShare = { n: 0, first: "" };
    const wall0 = performance.now(); let robotMs = 0;
    for (const at of checkpoints) {
      while (clock.stats.simTime < at - 1e-9) {
        clock.frame(1 / 60, speed, world, Infinity);
        {
          // AMR-AMR clearance: min center distance between any two AMR bodies (pallet AMRs + cycle shuttles/AGVs).
          const r0 = world.agents[0]?.dispatch.radius ?? 1.243;
          const bodies = [
            ...world.agents.map((a) => ({ id: a.object.id + ":" + a.dispatch.phase + (a.dispatch.gated ? "G" : ""), p: a.dispatch.carrier.position, r: a.dispatch.radius })),
            ...(world.cycle?.views ?? []).filter((v) => v.kind !== "forklift").map((v) => ({ id: v.id, p: v.vehicle.carrier.position, r: r0 })),
          ];
          for (const dock of dockPoses) {
            const inside = bodies.filter((b) => Math.hypot(b.p.x - dock.x, b.p.z - dock.z) < 1.0);
            if (inside.length > 1) { dockShare.n++; dockShare.first ||= `${dock.id}:${inside.map((b) => b.id).join("+")}@${clock.stats.simTime.toFixed(0)}s`; }
          }
          for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
            const a = bodies[i], b = bodies[j], d = Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z);
            if (process.env.GAP_DEBUG && d < a.r + b.r && Math.floor(clock.stats.simTime) % 3 === 0) {
              (minGap.logged ??= new Set()).add(a.id + b.id);
              const snap = world.cycle?.snapshot ?? [];
              console.log(`    gap ${d.toFixed(2)} t=${clock.stats.simTime.toFixed(1)} ${a.id}@${a.p.x.toFixed(2)},${a.p.z.toFixed(2)} ${snap.find((x) => x.id === a.id)?.state} | ${b.id}@${b.p.x.toFixed(2)},${b.p.z.toFixed(2)} ${snap.find((x) => x.id === b.id)?.state}`);
            }
            if (d < minGap.d) Object.assign(minGap, { d, pair: `${a.id}/${b.id}`, t: clock.stats.simTime, limit: a.r + b.r });
          }
        }
        if (clock.stats.simTime >= next) {
          next += 1;
          for (const a of world.agents) {
            const p = a.dispatch.carrier.position, prev = last.get(a.object.id);
            if (prev && a.dispatch.moving && Math.hypot(p.x - prev.x, p.z - prev.z) < 0.05) stalled.set(a.object.id, (stalled.get(a.object.id) ?? 0) + 1);
            last.set(a.object.id, p.clone());
          }
          if (process.env.FC_PHASES && world.cycle) for (const s of world.cycle.snapshot) {
            const m = phaseTime.get(s.id) ?? new Map();
            m.set(s.state, (m.get(s.state) ?? 0) + 1);
            phaseTime.set(s.id, m);
          }
          const hb = world.haltedBelts();
          for (const b of hb) beltHalt.set(b, (beltHalt.get(b) ?? 0) + 1);
          const h = hb.size > 0;
          haltedSec.n += h; haltedSec.streak = h ? haltedSec.streak + 1 : 0; haltedSec.max = Math.max(haltedSec.max, haltedSec.streak);
        }
      }
      const s = world.stats;
      console.log(`    perf: ${(clock.stats.simTime / ((performance.now() - wall0) / 1000)).toFixed(1)} sim-s/wall-s`);
      console.log(`  t=${at}s spawned ${s.spawned} placed ${world.placed} passed ${world.passed} shipped(AMR) ${world.dispatched} handedOff ${world.handedOff} forkliftStored ${world.forkliftStored} unloaded ${world.unloaded} haltedSec ${haltedSec.n} maxHaltStreak ${haltedSec.max}s`);
      if (prof) {
        const sorted = [...prof.steps].sort((a, b) => a - b), q = (x) => sorted[Math.min(sorted.length - 1, Math.floor(x * sorted.length))]?.toFixed(2);
        console.log(`    stepMs: n ${sorted.length} p50 ${q(0.5)} p99 ${q(0.99)} max ${sorted.at(-1)?.toFixed(1)} >16ms ${sorted.filter((x) => x > 16).length}`);
        console.log("    parts: " + [...prof.parts].sort((a, b) => b[1].max - a[1].max).slice(0, 14).map(([k, v]) => `${k} max ${v.max.toFixed(1)} tot ${v.total.toFixed(0)}`).join(" | "));
      }
      if (minGap.pair) console.log(`    amrMinGap: ${minGap.d.toFixed(3)}m limit ${minGap.limit.toFixed(3)}m ${minGap.pair} @${minGap.t.toFixed(0)}s ${minGap.d < minGap.limit - 1e-3 ? "COLLISION" : "ok"}`);
      {
        const ys = world.agents.map((a) => a.dispatch.stationYaw).filter(Boolean);
        const n = ys.reduce((m, y) => m + y.arrivals, 0), err = ys.reduce((m, y) => Math.max(m, y.maxError), 0);
        if (n) console.log(`    stationYaw: arrivals ${n} maxError ${(err * 180 / Math.PI).toFixed(3)}° ${err > 1e-3 ? "MISMATCH" : "ok"}`);
        if (err > 1e-3) process.exitCode = 1;
      }
      if (minGap.pair && minGap.d < minGap.limit - 1e-3) process.exitCode = 1;
      console.log(`    dockShare: ${dockShare.n ? `SHARED ${dockShare.n} ticks first ${dockShare.first}` : "ok"} (docks ${dockPoses.length})`);
      if (dockShare.n) process.exitCode = 1;
      console.log(`    floorLift: ${world.floorLiftAttempts ?? 0} forkliftHandoffs: ${world.forkliftHandoffs ?? 0} forkliftOutbound: ${world.forkliftOutbound ?? 0} warnings: ${[...(world.warnedMessages ?? [])].join(" / ") || "-"}`);
      if (phaseTime.size) console.log(`    phases: ${[...phaseTime].map(([id, m]) => `${id}[${[...m].map(([k, n]) => k + " " + n).join(", ")}]`).join(" ")}`);
      if (beltHalt.size) console.log(`    haltByBelt: ${[...beltHalt].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([b, n]) => `${b}:${n}s`).join(" ")}`);
      console.log(`    amr: ${world.agents.map(a => `${a.object.id}:${a.dispatch.phase} done=${a.completed} stall=${stalled.get(a.object.id) ?? 0}s@${a.dispatch.carrier.position.x.toFixed(1)},${a.dispatch.carrier.position.z.toFixed(1)}${a.target ? ">" + a.target : ""}${a.waitingReason ? "(" + a.waitingReason + ")" : ""}${process.env.AMR_STATUS ? " [" + a.dispatch.status + "]" : ""}`).join(" | ")}`);
      if (world.depalletizers.length || world.outboundBelts.length) console.log(`    depalletized ${world.depalletized} emptiedPallets ${world.emptiedPallets} outboundShipped(팔레트→outbound 벨트) ${world.outboundShipped} shipBelt(박스) ${world.shippedBoxes} robots: ${world.robots.map(r => r.object.id + ":" + r.status).join(" | ")}`);
      if (world.forkliftAgents.length) console.log(`    forklift: ${world.forkliftAgents.map(a => `${a.object.id}:${a.controller.stage ?? "idle"}@${a.controller.carrier.position.x.toFixed(1)},${a.controller.carrier.position.z.toFixed(1)} stored=${a.controller.stored} out=${a.controller.completed} recover=${a.controller.recoveries}${a.waitingReason ? "(" + a.waitingReason + ")" : ""}`).join(" | ")}`);
      if (process.env.BOX_STATES) { const m = new Map(); for (const b of world.boxes) { const k = `${b.state}@${b.belt?.name}:${Math.round(b.distance)}`; m.set(k, (m.get(k) ?? 0) + 1); } console.log(`    boxes: ${[...m].map(([k, n]) => k + "x" + n).join(" ")} halted: ${[...(world.haltedBelts?.() ?? [])].join(",")}`); }
      if (world.heldPalletBelts.length) console.log(`    palletHold: ${world.heldPalletBelts.map((h) => `${h.beltId}:pallet=${h.pallet} d=${h.distance.toFixed(2)} atStopper=${h.atStopper} amr=${h.agent ?? "-"} fed=${h.fed} n=${h.count} d=[${h.distances.map((x) => x.toFixed(2))}] arr=[${h.arrivals.map((x) => x.toFixed(0))}]`).join(" | ")}`);
      if (world.feedDockStats && Object.keys(world.feedDockStats).length) console.log(`    feedDocks: ${Object.entries(world.feedDockStats).map(([name, s]) => `${name} 도착 ${s.arrivals} · 가동 ${Math.round((s.busySec / clock.stats.simTime) * 100)}%`).join(" | ")}`);
      if (world.feedScan?.dropped) console.log(`    feedScan: ${JSON.stringify({ ...world.feedScan, inTransit: world.feedBoxIds?.size ?? 0 })}`);
      if (world.cycle) {
        const c = world.cycle.stats;
        if (world.cycle) console.log(`    handoff: n=${world.cycle.handoff.count} xz=${world.cycle.handoff.xz.toFixed(3)}m y=${world.cycle.handoff.y.toFixed(3)}m yaw=${(world.cycle.handoff.yaw * 180 / Math.PI).toFixed(1)}° | pick xz=${world.cycle.handoff.pickXz.toFixed(3)}m y=${world.cycle.handoff.pickY.toFixed(3)}m yaw=${(world.cycle.handoff.pickYaw * 180 / Math.PI).toFixed(1)}°`);
    console.log(`    cycle: scanTrips ${c.scanTrips} serviceTrips ${c.serviceTrips} swaps ${c.swaps} rackMFull ${c.rackMFull} agvTrips ${c.agvTrips} storedToRack ${c.storedToRack} shippedPallets ${c.shippedPallets} shippedBoxes ${world.shippedBoxes} overrides ${c.overrides} fallbacks ${c.fallbacks} emptyStacked ${c.emptyStacked} carrierTrips ${c.carrierTrips} palletsFed ${c.palletsFed} forkliftBusy ${Math.round(c.forkliftBusy ?? 0)}s forkliftOverlap ${Math.round(c.forkliftOverlap ?? 0)}s`);
        console.log(`    states: ${world.cycle.snapshot.map((s) => `${s.id}:${s.state}(${s.detail})`).join(" | ")}`);
        if (process.env.CYCLE_DEBUG) for (const v of [...world.cycle.forklifts, ...world.cycle.agvs]) {
          const p = v.vehicle.position, path = v.vehicle.path.map((q) => `${q.x.toFixed(1)},${q.z.toFixed(1)}`).join(" ");
          console.log(`    ${v.object.id} ${v.state} @${p.x.toFixed(2)},${p.z.toFixed(2)} h${v.vehicle.heading.toFixed(2)} held${v.vehicle.heldSeconds.toFixed(0)} cur${v.vehicle.pathCursor} path[${path}]`);
        }
        console.log(`    robots: ${world.robots.map((r) => r.object.id + ":" + r.status).join(" | ")}`);
      }
      if (world.rackStored?.size) console.log(`    racks: ${[...world.rackStored].map(([, v]) => v.filter(Boolean).length).join(",")}  pallets: ${world.pallets.map(p => p.count + "/" + p.slots.length).join(",")}`);
      else console.log(`    pallets: ${world.pallets.map(p => p.count + "/" + p.slots.length).join(",")}`);
    }
    world.dispose?.();
  }
} finally { await server.close(); }
