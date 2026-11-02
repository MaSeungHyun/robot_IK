// Headless recording (read-only on templates): node scripts/record-sim.mjs [--template=N | --file=t.json] [--seconds=60] [--out=rec.json] [--floor]
// --floor reproduces the old floor-level arm mount (before the pedestal elevation fix) for comparison.
import { createServer } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2), arg = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
globalThis.document ??= { cookie: "" }; globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
try {
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
  const file = arg("file");
  const template = file ? JSON.parse(readFileSync(file, "utf8")) : structuredClone(SCENE_TEMPLATES[+arg("template", 0)]);
  const seconds = +arg("seconds", 60);
  const result = simulateTemplate(template, { robot: robot.scene, box: box.scene, pallet: pallet.scene }, { seconds, warmup: 0, record: true, floorMount: args.includes("--floor") });
  if ("error" in result) throw new Error(result.error);
  const rec = result.recording;
  const out = arg("out"); if (out) writeFileSync(out, JSON.stringify(rec));
  const d = rec.contacts.map((c) => c.distance), dy = rec.contacts.map((c) => c.dy);
  const stat = (a) => a.length ? `min ${Math.min(...a).toFixed(3)} max ${Math.max(...a).toFixed(3)} mean ${(a.reduce((s, v) => s + v, 0) / a.length).toFixed(3)}` : "-";
  console.log(`template ${rec.template} ${seconds}s placed ${result.placedPerHour}/h | suction ${rec.suction.length} (attach ${rec.contacts.length}) boxParents ${rec.boxParents.length} keyframes ${rec.boxKeyframes.length} pallets ${rec.pallets.length}`);
  console.log(`  attach contact distance ${stat(d)} | dy ${stat(dy)}`);
  console.log(`  kinds ${JSON.stringify(rec.boxParents.reduce((m, e) => ((m[e[2]] = (m[e[2]] ?? 0) + 1), m), {}))} palletKinds ${JSON.stringify(rec.pallets.reduce((m, e) => ((m[e[2]] = (m[e[2]] ?? 0) + 1), m), {}))}`);
  if (args.includes("--verbose")) console.log(JSON.stringify(rec.contacts.slice(0, 5)), JSON.stringify(rec.boxParents.slice(0, 6)), JSON.stringify(rec.pallets.slice(0, 6)));
} finally { await server.close(); }
