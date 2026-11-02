// Chunked monitoring recording exporter (arms on pedestals, SimRecorder v1 + 10 Hz tracks).
// node scripts/record-run.mjs [--template=5] [--seconds=600] [--chunk=600] [--seed=12345] [--run=ID] [--out=DIR] [--measure]
import { createServer } from "vite";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2), arg = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
globalThis.document ??= { cookie: "" }; globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
const JOINTS = ["hand00", "hand01", "hand02", "hand03", "hand04"];
try {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const strip = (glb) => {
    const n = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + n).toString("utf8"));
    delete json.textures; delete json.images; delete json.samplers;
    for (const m of json.materials ?? []) { for (const k of Object.keys(m)) if (k.endsWith("Texture")) delete m[k];
      if (m.pbrMetallicRoughness) for (const k of Object.keys(m.pbrMetallicRoughness)) if (k.endsWith("Texture")) delete m.pbrMetallicRoughness[k]; delete m.extensions; }
    json.extensionsUsed = (json.extensionsUsed ?? []).filter((e) => !/texture|webp|basisu/i.test(e));
    json.extensionsRequired = (json.extensionsRequired ?? []).filter((e) => !/texture|webp|basisu/i.test(e));
    let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
    const rest = glb.subarray(20 + n), h = Buffer.alloc(20);
    h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + text.length + rest.length, 8); h.writeUInt32LE(text.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
    return Buffer.concat([h, text, rest]);
  };
  const parse = (f) => new Promise((res, rej) => { const b = strip(readFileSync(f)); new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "", res, rej); });
  const [robot, box, pallet] = await Promise.all(["RobotArm", "box", "pallet"].map((n) => parse(`src/assets/models_original/${n}.glb`)));
  const { SCENE_TEMPLATES } = await server.ssrLoadModule("/src/constants/sceneTemplates.ts");
  const { simulateTemplate } = await server.ssrLoadModule("/src/domain/layout/simulateLayout.ts");
  const ti = +arg("template", 5), template = structuredClone(SCENE_TEMPLATES[ti]);
  const warmup = +arg("warmup", 0), recordSec = +arg("seconds", 600), seconds = warmup + recordSec, chunkLen = +arg("chunk", 600), seed = +arg("seed", 12345), measure = args.includes("--measure");
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const runId = arg("run", `run-${day}-t06-${Math.round(recordSec / 60)}m-w${warmup}-s${seed}`);
  const outDir = arg("out", join("C:/Users/nct12/Desktop/smart-factory-monitoring/public/data", runId));
  if (!measure) mkdirSync(outDir, { recursive: true });
  const r1 = (v) => Math.round(v * 10), cm = (v) => Math.round(v * 100), d10 = (rad) => Math.round(rad * 1800 / Math.PI);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const yawOf = (o) => { o.getWorldQuaternion(q); return e.setFromQuaternion(q, "YXZ").y; };
  const mapRobot = (row) => row.state !== "working" ? "idle" : /GRASP|PICK|ATTACH|흡착/.test(row.status) ? "picking" : /PLACE|RELEASE|DROP|적재 위치/.test(row.status) ? "placing" : "moving";
  const mapAgent = (row) => ({ idle: "idle", waiting: "idle", disabled: "idle", yielding: "moving", charging: "charging", blocked: "error", pickup: "picking", loading: "picking", receiving: "picking", unloading: "placing", storing: "placing" })[row.state] ?? "moving";

  let ctxRef = null, amrNodes = new Map(), nextAmrScan = 0, nextPose = 0, nextStatus = 0, nextMinute = 60, chunkIdx = 0, chunk = null;
  const prevEq = new Map(), chunks = [], minutes = [], events = [], lastState = new Map(), suctionOn = new Map(), cursor = {};
  let lastTotals = null, amrIds = [], robotIds = [], equipment = [], lastMinute = null, truth = new Map();
  const REC_KEYS = ["suction", "contacts", "boxParents", "boxKeyframes", "pallets", "palletParents"];
  const counts = (w) => { const s = w.stats, c = w.cycle?.stats ?? {}; return { inbound: w.cargo.totals.inbound, scanned: (w.inspection.snapshots ?? []).reduce((n, x) => n + x.scanned, 0), defects: (w.inspection.snapshots ?? []).reduce((n, x) => n + x.faults, 0), placed: w.placed, passed: w.passed, depalletized: w.depalletized ?? 0, palletsShipped: s.completedPallets ?? 0, outbound: c.outboundPallets ?? 0, storedToRack: c.storedToRack ?? 0, shippedPallets: c.shippedPallets ?? 0, carrierTrips: c.carrierTrips ?? 0, forkliftStored: w.forkliftStored ?? 0, wip: s.live }; };
  const snapshot = (t, { world, recorder }) => {
    const boxes = [];
    for (const [id, b] of recorder.boxes) if (b.parent) { b.getWorldPosition(p); const k = (recorder.parentOf.get(id) ?? "||").split("|"); boxes.push([id, k[0], k[1] === "null" ? null : k[1], cm(p.x), cm(p.y), cm(p.z)]); }
    const pallets = [];
    for (const rec of world.cargo.pallets.values()) if (rec.state !== "shipped") { const [pos, yaw] = recorder.palletPose(rec.id); pallets.push([rec.id, rec.state, rec.grade, rec.boxIds.length, pos, yaw, recorder.palletCarrier.get(rec.id) ?? null]); }
    const eq = world.equipment;
    return { t: +t.toFixed(3), boxes, boxFields: ["id", "parentKind", "parentId", "x", "y", "z"], pallets, palletFields: ["id", "state", "grade", "boxes", "pos", "yaw", "carrierKey"],
      racks: (eq.racks ?? []).map((r) => ({ id: r.id, slots: r.slots.map((s) => s.state === "empty" ? 0 : s.state === "reserved" ? [2, s.palletId ?? null] : [1, s.palletId ?? null, s.grade ?? null, s.boxes ?? null]) })),
      suction: Object.fromEntries(robotIds.map((id) => [id, suctionOn.get(id) ?? null])), counts: counts(world),
      states: Object.fromEntries(lastState) };
  };
  const newChunk = (t, ctx) => { chunk = { i: chunkIdx, t0: warmup + chunkIdx * chunkLen, t1: Math.min(seconds, warmup + (chunkIdx + 1) * chunkLen), snapshot: snapshot(t, ctx), t: [], joints: Object.fromEntries(robotIds.map((id) => [id, []])), amrs: Object.fromEntries(amrIds.map((id) => [id, []])), status: [], events: [] }; for (const k of REC_KEYS) cursor[k] = ctx.recorder.data[k].length; };
  const flush = (ctx) => {
    const d = ctx.recorder.data, recording = { version: d.version, template: d.template, seed: d.seed, seconds: d.seconds };
    for (const k of REC_KEYS) { recording[k] = d[k].slice(cursor[k]); d[k].length = 0; cursor[k] = 0; }
    // Box keyframes: omit boxes that moved < 1 cm since their last emitted position (hold last; chunk snapshot seeds positions).
    const held = new Map(chunk.snapshot.boxes.map((b) => [b[0], [b[3] / 100, b[4] / 100, b[5] / 100]]));
    recording.boxKeyframes = recording.boxKeyframes.map((k) => ({ t: k.t, boxes: k.boxes.filter((b) => { const h = held.get(b[0]); if (h && Math.hypot(h[0] - b[1], h[1] - b[2], h[2] - b[3]) < 0.01) return false; held.set(b[0], [b[1], b[2], b[3]]); return true; }) }));
    recording.boxKeyframeEncoding = "only boxes moved >= 1 cm since their previous emitted position; hold last value (snapshot seeds)";
    const file = `chunk-${String(chunk.i).padStart(3, "0")}.json`;
    const body = { meta: { runId, template: template.id, chunk: chunk.i, t0: chunk.t0, t1: chunk.t1, poseHz: 10, statusHz: 2, jointNames: JOINTS, jointUnits: "0.1 deg int", amrUnits: "x,z cm int, yaw 0.1 deg int", armMount: "pedestal" },
      snapshot: chunk.snapshot, tracks: { t: chunk.t, joints: chunk.joints, amrs: chunk.amrs }, status: chunk.status, events: chunk.events, recording };
    if (!measure) { const s = JSON.stringify(body); writeFileSync(join(outDir, file), s); chunks.push({ i: chunk.i, t0: chunk.t0, t1: chunk.t1, file, bytes: Buffer.byteLength(s) }); }
    console.log(`chunk ${chunk.i} [${chunk.t0}-${chunk.t1}] samples ${chunk.t.length} rec ${REC_KEYS.map((k) => k + "=" + recording[k].length).join(" ")} ${chunks.at(-1)?.bytes ?? 0}B mem ${Math.round(process.memoryUsage().heapUsed / 1e6)}MB`);
    chunkIdx++; chunk = null;
  };
  const began = Date.now();
  const onFrame = (t, ctx) => {
    ctxRef = ctx; const { world, scene, controllers, holders, recorder, objects } = ctx;
    if (!robotIds.length) {
      robotIds = world.robots.map((r) => r.object.id); amrIds = objects.filter((o) => o.kind === "amr").map((o) => o.id);
      equipment = objects.map((o) => { const hi = robotIds.indexOf(o.id); return { id: o.id, kind: o.kind, name: o.name, pos: [+o.x.toFixed(3), +o.z.toFixed(3)], yaw: +(o.yaw ?? 0).toFixed(4), elevation: hi >= 0 ? +holders[hi].position.y.toFixed(3) : +((o.y ?? 0).toFixed?.(3) ?? 0) }; });
      lastTotals = counts(world);
    }
    for (let k = suctionIdx; k < recorder.data.suction.length; k++) { const [, rid, on, bid] = recorder.data.suction[k]; suctionOn.set(rid, on ? bid : null); }
    suctionIdx = recorder.data.suction.length;
    if (t >= nextAmrScan) { nextAmrScan = t + 5; amrNodes = new Map();
      for (const a of world.agents ?? []) if (a.dispatch?.carrier) amrNodes.set(a.object.id, a.dispatch.carrier);
      for (const a of world.forkliftAgents ?? []) if (a.controller?.carrier) amrNodes.set(a.object.id, a.controller.carrier);
      if (world.cycle) for (const v of Object.values(world.cycle)) if (Array.isArray(v)) for (const x of v) { const c = x?.vehicle?.carrier ?? x?.carrier; const id = x?.object?.id ?? (typeof x?.id === "string" ? x.id : undefined); if (id && c?.isObject3D && !amrNodes.has(id)) amrNodes.set(id, c); } }
    const rackOcc = () => { const r = world.equipment.racks ?? []; const n = r.reduce((s, x) => s + x.slots.length, 0), f = r.reduce((s, x) => s + x.slots.filter((y) => y.state === "stored").length, 0); return [f, n]; };
    if (t < warmup) { for (const k of REC_KEYS) recorder.data[k].length = 0; suctionIdx = 0;
      if (t >= nextMinute - 1e-6) { nextMinute += 60; if (Math.round(t) % 300 === 0) { const c = counts(world), [f, n] = rackOcc(); console.log(`warmup t=${Math.round(t)}s rack ${f}/${n} stored ${c.storedToRack} shipped ${c.shippedPallets} outbound ${c.outbound} placed ${c.placed} depal ${c.depalletized} wall ${Math.round((Date.now() - began) / 1000)}s`); } }
      return; }
    if (startInfo === null) { const [f, n] = rackOcc(); startInfo = { simTimeOffset: warmup, rackOccupancyAtStart: { stored: f, slots: n, ratio: +(f / Math.max(1, n)).toFixed(3) }, countsAtStart: counts(world) }; lastTotals = counts(world); nextMinute = warmup + 60; nextStatus = t; nextPose = t; }
    if (!chunk) newChunk(t, ctx);
    if (t >= nextStatus) { nextStatus += 0.5;
      const eq = world.equipment, row = { t: +t.toFixed(2), counts: counts(world), equipment: {} }, all = {};
      for (const r of eq.robots) all[r.id] = { state: mapRobot(r), label: r.status, count: r.count };
      for (const a of eq.agents) all[a.id] = { state: mapAgent(a), label: a.status, count: a.completed, battery: Math.round(a.battery) };
      for (const [id, v] of Object.entries(all)) { const key = JSON.stringify(v); if (chunk.status.length === 0 || prevEq.get(id) !== key) row.equipment[id] = v; prevEq.set(id, key); }
      for (const [id, v] of Object.entries(all)) { const was = lastState.get(id); if (was !== v.state) { const ev = { t: row.t, equipmentId: id, from: was ?? null, to: v.state }; chunk.events.push(ev); lastState.set(id, v.state); } }
      chunk.status.push(row);
    }
    if (t >= nextPose - 1e-6) { nextPose = Math.round(t * 10 + 1) / 10;
      chunk.t.push(+t.toFixed(2));
      controllers.forEach((c, i) => { const m = new Map(c.getJointAngles().map((j) => [j.name, j.degrees])); chunk.joints[robotIds[i]].push(JOINTS.map((n) => r1(m.get(n) ?? 0))); });
      for (const id of amrIds) { const o = amrNodes.get(id); if (!o) { chunk.amrs[id].push(null); continue; } o.getWorldPosition(p); chunk.amrs[id].push([cm(p.x), cm(p.z), d10(yawOf(o))]); }
      if (measure) for (const [id, b] of recorder.boxes) if (b.parent) { const k = recorder.parentOf.get(id) ?? ""; b.getWorldPosition(p); let a = truth.get(id); if (!a) truth.set(id, (a = [])); a.push([t, p.x, p.y, p.z, k.startsWith("conveyor")]); }
    }
    if (t >= nextMinute - 1e-6) { const c = counts(world), eq = world.equipment, d = {}; for (const k in c) d[k] = k === "wip" ? c[k] : c[k] - lastTotals[k]; lastTotals = c;
      minutes.push({ m: (nextMinute - warmup) / 60, tSim: nextMinute, scans: { normal: d.scanned - d.defects, defect: d.defects }, ...d,
        robots: Object.fromEntries(eq.robots.map((r) => [r.id, { cycles: r.count, util: +r.utilization.toFixed(1), state: r.state }])),
        amrBusy: Object.fromEntries(eq.agents.map((a) => [a.id, mapAgent(a) !== "idle" && mapAgent(a) !== "charging" ? 1 : 0])),
        rackOccupancy: (eq.racks ?? []).reduce((s, r) => s + r.slots.filter((x) => x.state === "stored").length, 0), rackSlots: (eq.racks ?? []).reduce((s, r) => s + r.slots.length, 0) });
      for (const a of eq.agents) amrBusySum[a.id] = (amrBusySum[a.id] ?? 0) + (minutes.at(-1).amrBusy[a.id]);
      nextMinute += 60; if (minutes.length % 10 === 0) console.log(`t=${Math.round(t)}s placed ${c.placed} depal ${c.depalletized} stored ${c.storedToRack} shipped ${c.shippedPallets} wall ${Math.round((Date.now() - began) / 1000)}s`); }
    if (t >= chunk.t1 - 1e-9 || t >= seconds - 1e-9) flush(ctx);
  };
  let suctionIdx = 0, startInfo = null; const amrBusySum = {};
  const result = simulateTemplate(template, { robot: robot.scene, box: box.scene, pallet: pallet.scene }, { seconds, warmup: 0, seed, record: true, onFrame });
  if ("error" in result) throw new Error(result.error);
  if (chunk) flush(ctxRef);
  if (measure) {
    const err = (hz) => { const step = 1 / hz, errs = []; for (const a of truth.values()) { let i = 0;
      for (const s of a) { if (!s[4]) continue; const k0 = Math.floor(s[0] / step + 1e-6) * step, k1 = k0 + step;
        const A = a.find((x) => Math.abs(x[0] - k0) < 0.051), B = a.find((x) => Math.abs(x[0] - k1) < 0.051); if (!A || !B || !A[4] || !B[4]) continue;
        const f = (s[0] - A[0]) / Math.max(1e-6, B[0] - A[0]); errs.push(Math.hypot(A[1] + f * (B[1] - A[1]) - s[1], A[2] + f * (B[2] - A[2]) - s[2], A[3] + f * (B[3] - A[3]) - s[3])); } }
      errs.sort((x, y) => x - y); const at = (pp) => errs[Math.floor(pp * (errs.length - 1))] ?? 0;
      return `${hz}Hz n=${errs.length} mean ${(errs.reduce((s, v) => s + v, 0) / errs.length * 100).toFixed(2)}cm p95 ${(at(0.95) * 100).toFixed(2)}cm p99 ${(at(0.99) * 100).toFixed(2)}cm max ${(at(1) * 100).toFixed(2)}cm`; };
    console.log("conveyor-box interpolation error vs 10Hz truth:", err(1), "|", err(2));
  } else {
    const last = minutes.at(-1) ?? {}, total = counts(ctxRef.world), mins = minutes.length || 1;
    const eq = ctxRef.world.equipment;
    const aggregates = { runId, sampleMinutes: minutes.length, perMinute: minutes, totals: total,
      robots: Object.fromEntries(eq.robots.map((r) => [r.id, { cycles: r.count, utilization: +r.utilization.toFixed(1) }])),
      amrUtilization: Object.fromEntries(Object.entries(amrBusySum).map(([id, n]) => [id, +(n / mins).toFixed(3)])),
      rackOccupancy: { stored: last.rackOccupancy ?? 0, slots: last.rackSlots ?? 0 },
      alarms: ctxRef.world.cargo.misses.map((m) => ({ t: m.t, equipmentId: m.equipmentId, boxId: m.boxId ?? null, message: m.reason })) };
    writeFileSync(join(outDir, "aggregates.json"), JSON.stringify(aggregates));
    const manifest = { version: 1, runId, template: template.id, seed, duration: recordSec, simTimeOffset: warmup, rackOccupancyAtStart: startInfo?.rackOccupancyAtStart, countsAtStart: startInfo?.countsAtStart, statusEncoding: "status[].equipment holds only entries changed since previous row (first row per chunk is full)", timeBase: "all t are absolute sim seconds; subtract simTimeOffset for playback time", sampleHz: { joints: 10, amrs: 10, status: 2, boxKeyframes: 1 }, jointNames: JOINTS, armMount: "pedestal", chunkSeconds: chunkLen, equipment, chunks, aggregates: "aggregates.json", createdAt: new Date().toISOString() };
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1));
    console.log(`done ${runId} -> ${outDir} chunks ${chunks.length} total ${chunks.reduce((s, c) => s + c.bytes, 0)}B wall ${Math.round((Date.now() - began) / 1000)}s`);
    console.log("FINAL", JSON.stringify(total));
  }
} finally { await server.close(); }
