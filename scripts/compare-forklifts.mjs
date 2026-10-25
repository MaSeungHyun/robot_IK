// Service forklift split work: 1 forklift vs 2 (auto) vs 2 (하역 전담 + 빈 팔레트 공급 전담) on a pallet-cycle template.
// node scripts/compare-forklifts.mjs [--template=10-pallet-cycle-rack-m] [--at=1800]  (exit 1 on a failed check)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const name = (args.find((a) => a.startsWith("--template=")) ?? "--template=10-pallet-cycle-rack-m").slice(11);
const at = Number((args.find((a) => a.startsWith("--at=")) ?? "--at=1800").slice(5));
const base = JSON.parse(readFileSync(`src/constants/templates/${name}.json`, "utf8"));
const OFFSET = Number((args.find((a) => a.startsWith("--offset=")) ?? "--offset=6").slice(9));
const dir = mkdtempSync(join(tmpdir(), "forklift-"));

const variant = (id, roles) => {
  const t = structuredClone(base);
  t.id = `${base.id}-${id}`;
  const services = t.equipment.filter((e) => e.settings?.forkliftTask === "service");
  const added = services.map((e) => {
    // Second forklift parked beside the first, OFFSET m along its side of the service dock.
    const side = { x: Math.cos(e.yaw), z: -Math.sin(e.yaw) };
    return { ...structuredClone(e), x: e.x + side.x * OFFSET, z: e.z + side.z * OFFSET };
  });
  if (roles) {
    services.forEach((e) => (e.settings.forkliftRole = roles[0]));
    added.forEach((e) => (e.settings.forkliftRole = roles[1]));
    t.equipment.push(...added);
  }
  const file = join(dir, `${id}.json`);
  writeFileSync(file, JSON.stringify(t));
  return file;
};
const run = (file) => {
  let out;
  try { out = execFileSync("node", ["scripts/flow-check.mjs", `--file=${file}`, `--at=${at}`, "--speed=8"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }); }
  catch (error) { out = String(error.stdout ?? ""); }
  const num = (key) => Number(out.match(new RegExp(`${key} (\\d+)`))?.[1] ?? NaN);
  return { swaps: num("swaps"), serviceTrips: num("serviceTrips"), shipped: num("shippedBoxes"), busy: num("forkliftBusy"), overlap: num("forkliftOverlap"), gap: out.match(/amrMinGap: [^\n]*/)?.[0] ?? "" };
};
const cases = [["1대 (자동)", null], ["2대 자동/자동", ["auto", "auto"]], ["2대 하역 전담/공급 전담", ["unload", "supply"]]];
const results = cases.map(([label, roles]) => ({ label, ...run(variant(roles ? roles.join("-") : "one", roles)) }));
for (const r of results) console.log(`${r.label.padEnd(18)} 교체 ${r.swaps} · 서비스 이동 ${r.serviceTrips} · 출하 박스 ${r.shipped} · 지게차 작업 ${r.busy}s · 동시 작업 ${r.overlap}s · ${r.gap}`);
const [one, auto, split] = results;
const checks = [
  ["split: both forklifts work at the same time (overlap > 0)", split.overlap > 0],
  ["2 forklifts swap at least as many pallets as 1", auto.swaps >= one.swaps && split.swaps >= one.swaps],
  ["no AMR collision", results.every((r) => r.gap && !/COLLISION/.test(r.gap))],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? "ok  " : "FAIL"} ${label}`); failed += !ok; }
process.exitCode = failed ? 1 : 0;
