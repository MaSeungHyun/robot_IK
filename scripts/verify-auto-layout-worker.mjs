// Worker smoke test: loads src/workers/autoLayout.worker.ts through vite ssrLoadModule with a stubbed worker
// scope (postMessage, fetch of the ?url model paths from disk) and runs one small search end to end.
// node scripts/verify-auto-layout-worker.mjs   (exit 0 = a run completed with at least one simulated candidate)
import { createServer } from "vite";
import { readFileSync } from "node:fs";

globalThis.document ??= { cookie: "" };
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const messages = [];
globalThis.postMessage = (message) => { messages.push(message); if (message.type === "progress") process.stdout.write(`\rprogress ${message.progress.evaluated}/${message.progress.total} ${message.progress.current}        `); };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const local = String(url).match(/\/src\/assets\/models\/[\w.-]+\.glb/);
  if (!local) return realFetch(url);
  const file = readFileSync(`.${local[0]}`);
  return { arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) };
};
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { handleRequest } = await server.ssrLoadModule("/src/workers/autoLayout.worker.ts");
  const began = Date.now();
  await handleRequest({ type: "run", constraints: { width: 18, depth: 14, targetPerHour: 300, storageHours: 1 }, options: { seconds: 600, warmup: 120, top: 3, patterns: ["straight"] } });
  const done = messages.find((m) => m.type === "done"), error = messages.find((m) => m.type === "error");
  console.log();
  if (error || !done) { console.error("FAIL", error?.message ?? "no result"); process.exitCode = 1; }
  else {
    const r = done.result;
    console.log(`done in ${((Date.now() - began) / 1000).toFixed(1)}s · ${messages.filter((m) => m.type === "progress").length} progress messages · evaluated ${r.evaluated} · ${r.diagnosis.code}`);
    for (const c of r.ranked) console.log(`  ${c.candidate.template.id} met=${c.met} placed=${c.metrics.placedPerHour}/h racks=${c.candidate.counts.racks} slots=${c.candidate.storage.slots}/${c.candidate.storage.required} score=${c.score}`);
    if (!r.ranked.length) { console.error("FAIL no simulated candidate"); process.exitCode = 1; }
  }
} finally { await server.close(); }
