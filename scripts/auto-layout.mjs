// Auto layout search: node scripts/auto-layout.mjs --width=30 --depth=20 --target=600 [--door=south:0:3]
//   [--storage-hours=2 | --storage-pallets=N] [--max-robots=24] [--max-amrs=6] [--max-racks=N] [--aisle=2.64]
//   [--mode=fixed --robots=8 --amrs=3 --racks=6 --docks=1]  (fixed equipment, max throughput)
//   [--seconds=1500] [--warmup=300] [--top=5] [--out=.tmp/auto-layout] [--patterns=straight,L,U]
// Same search and simulation as the in-app worker (src/domain/layout/searchLayouts.ts + simulateLayout.ts),
// loaded through vite ssrLoadModule; writes the top N as SceneTemplate JSON (importable with loadTemplate).
import { createServer } from "vite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const num = (name) => (arg(name) === undefined ? {} : { [name.replace(/-(\w)/g, (_, c) => c.toUpperCase())]: +arg(name) });
const doorArg = arg("door");
const constraints = {
  width: +arg("width", 30), depth: +arg("depth", 20), height: +arg("height", 6), targetPerHour: +arg("target", 600),
  maxRobots: +arg("max-robots", 24), maxAmrs: +arg("max-amrs", 6),
  ...(arg("mode") === "fixed" ? { mode: "fixed", fixed: { robots: +arg("robots", 8), amrs: +arg("amrs", 3), racks: +arg("racks", 6), docks: +arg("docks", 1) } } : {}),
  ...num("max-racks"), ...num("aisle"), ...num("storage-hours"), ...num("storage-pallets"),
  ...(doorArg ? { door: (([wall, offset, width]) => ({ wall, offset: offset === undefined ? undefined : +offset, width: width === undefined ? undefined : +width }))(doorArg.split(":")) } : {}),
};
const seconds = +arg("seconds", 1500), warmup = +arg("warmup", 300), top = +arg("top", 5);
const patterns = arg("patterns", "straight,L,U").split(",");
const outDir = path.resolve(arg("out", ".tmp/auto-layout"));

globalThis.document ??= { cookie: "" };
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
try {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { stripGlbTextures } = await load("/src/domain/layout/stripGlbTextures.ts");
  const { simulateTemplate } = await load("/src/domain/layout/simulateLayout.ts");
  const { searchLayouts } = await load("/src/domain/layout/searchLayouts.ts");
  const parse = async (name) => {
    const file = readFileSync(`src/assets/models/${name}.glb`);
    return (await new GLTFLoader().parseAsync(stripGlbTextures(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)), "")).scene;
  };
  const [robot, box, pallet] = await Promise.all(["robot", "box", "pallet"].map(parse));
  console.log(`constraints ${JSON.stringify(constraints)} · ${seconds}s sim (warm-up ${warmup}s)`);
  const result = await searchLayouts(constraints, {
    top, patterns,
    evaluate: (candidate) => simulateTemplate(candidate.template, { robot, box, pallet }, { seconds, warmup }),
    onProgress: ({ evaluated, total, last }) => {
      if (!last) return;
      const m = last.metrics;
      console.log(`  [${evaluated}/${total}] ${last.candidate.template.id.padEnd(30)} ${m ? `placed ${m.placedPerHour}/h passed ${m.passedPerHour}/h palletWait ${(m.palletWaitShare * 100).toFixed(0)}% util ${(m.robotUtilization * 100).toFixed(0)}% score ${last.score} (${m.cpuMs}ms)` : `skip: ${last.note}`}`);
    },
  });
  mkdirSync(outDir, { recursive: true });
  const summary = result.ranked.map((r, i) => {
    const file = path.join(outDir, `${String(i + 1).padStart(2, "0")}-${r.candidate.template.id}.json`);
    writeFileSync(file, JSON.stringify(r.candidate.template, null, 2));
    return { rank: i + 1, id: r.candidate.template.id, met: r.met, score: r.score, ...r.candidate.counts, rackSlots: r.candidate.storage.slots, storageRequired: r.candidate.storage.required,
      crossings: r.candidate.crossings, closeness: r.candidate.closeness, travel: r.candidate.travel, rackDistance: r.candidate.rackDistance, usedArea: r.candidate.usedArea, ...r.metrics, file: path.relative(process.cwd(), file) };
  });
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ constraints, seconds, warmup, storage: result.storage, diagnosis: result.diagnosis, ranked: summary, evaluated: result.evaluated }, null, 2));
  console.log(`\nstorage: ${result.storage.pallets} pallets -> ${result.storage.needed} racks (${result.storage.racks} placed) · ${result.diagnosis.code}: ${result.diagnosis.message}`);
  console.log("TOP", top);
  for (const r of summary) console.log(`#${r.rank} ${r.id} met=${r.met} score=${r.score} robots=${r.robots} amrs=${r.amrs} forklifts=${r.forklifts} docks=${r.docks} racks=${r.racks} slots=${r.rackSlots}/${r.storageRequired} belts=${r.conveyors} area=${r.usedArea}m2 placed=${r.placedPerHour}/h passed=${r.passedPerHour}/h palletWait=${(r.palletWaitShare * 100).toFixed(1)}% util=${(r.robotUtilization * 100).toFixed(0)}% crossings=${r.crossings} travel=${r.travel}m rackDist=${r.rackDistance}m closeness=${r.closeness}`);
  console.log("written:", outDir);
} finally { await server.close(); }
