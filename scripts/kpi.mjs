// Headless KPI comparison: npm run kpi -- --templates=0,5 --seconds=600 [--speed=10] [--interval=1] [--cell=2] [--json=out.json]
// Runs each template for the same simulated time and prints a side-by-side table (domain/kpi KpiCollector report).
import { writeFileSync } from "node:fs";
import { openHarness } from "./lib/headlessSim.mjs";
const args = process.argv.slice(2);
const opt = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const templates = opt("templates", "0,5").split(",").map(Number);
const seconds = Number(opt("seconds", 600)), speed = Number(opt("speed", 10));
const kpiConfig = { interval: Number(opt("interval", 1)), cellSize: Number(opt("cell", 2)) };
const json = opt("json", null);
const harness = await openHarness();
const results = [];
try {
  for (const index of templates) {
    const { world, template, ms } = harness.run(index, seconds, speed, { kpi: kpiConfig });
    results.push({ template: index + 1, name: template.name ?? "", report: world.kpi.report() });
    console.error(`template ${String(index + 1).padStart(2, "0")} done · ${(ms / 1000).toFixed(1)}s CPU`);
  }
} finally {
  await harness.close();
}
const f1 = (v) => v.toFixed(1), pct = (v) => `${(v * 100).toFixed(1)}%`;
const top = (r) => r.congestion.hotspots[0];
const rows = [
  ["시뮬레이션 시간 (s)", (r) => f1(r.elapsed)],
  ["박스 투입", (r) => String(r.counters.boxesIn)],
  ["박스 적재", (r) => String(r.counters.placed)],
  ["박스 통과", (r) => String(r.counters.passed)],
  ["팔레트 입고", (r) => String(r.counters.palletsIn)],
  ["팔레트 출고", (r) => String(r.counters.palletsShipped)],
  ["투입 /h", (r) => f1(r.perHour.boxesIn)],
  ["적재 /h", (r) => f1(r.perHour.placed)],
  ["출고 팔레트 /h", (r) => f1(r.perHour.palletsShipped)],
  ["평균 WIP (박스)", (r) => f1(r.waiting.avgWip)],
  ["박스 체류 (s)", (r) => f1(r.waiting.boxQueueSeconds)],
  ["도크/배정 대기 (s)", (r) => f1(r.waiting.dockWaitSeconds)],
  ["교통 대기 (s)", (r) => f1(r.congestion.trafficWaitSeconds)],
  ["혼잡 셀 (x,z)", (r) => (top(r) ? `${f1(top(r).x)},${f1(top(r).z)} ${f1(top(r).seconds)}s` : "-")],
  ["병목 설비", (r) => (r.bottleneck ? `${r.bottleneck.name} ${pct(r.bottleneck.utilization)}${r.bottleneck.reason === "blocking" ? " (막힘)" : ""}` : "-")],
  ["설비 평균 가동률", (r) => (r.equipment.length ? pct(r.equipment.reduce((a, e) => a + e.utilization, 0) / r.equipment.length) : "-")],
];
const header = ["KPI", ...results.map(r => `${String(r.template).padStart(2, "0")} ${r.name}`)];
const table = [header, ...rows.map(([label, f]) => [label, ...results.map(r => f(r.report))])];
const width = (s) => [...s].reduce((w, ch) => w + (/[\u1100-\uffff]/.test(ch) ? 2 : 1), 0);
const cols = header.map((_, c) => Math.max(...table.map(row => width(row[c]))));
const line = (row) => row.map((cell, c) => cell + " ".repeat(cols[c] - width(cell))).join(" | ");
console.log(line(table[0])); console.log(cols.map(w => "-".repeat(w)).join("-|-"));
for (const row of table.slice(1)) console.log(line(row));
for (const r of results) {
  console.log(`\n${String(r.template).padStart(2, "0")} ${r.name} · 설비 가동률 (바쁨/유휴/대기/막힘 s)`);
  for (const e of r.report.equipment) console.log(`  ${e.name.padEnd(14)} ${pct(e.utilization).padStart(6)}  ${f1(e.seconds.busy)}/${f1(e.seconds.idle)}/${f1(e.seconds.waiting)}/${f1(e.seconds.blocked)}`);
}
if (json) { writeFileSync(json, JSON.stringify({ seconds, speed, config: kpiConfig, results }, null, 2)); console.error(`wrote ${json}`); }