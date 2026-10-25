// Headless end-to-end check of the two pallet-handling variants (node scripts/verify-pallet-modes.mjs):
//  - pallet-cycle-inbound-forklift-empty: palletized inbound, the service forklift collects the emptied pallet off the AMR
//  - pallet-cycle-forklift-carrier: the forklift holds the pallet while a robot loads it and carries it to the depalletizer
// Runs scripts/flow-check.mjs on each template and asserts throughput (boxes shipped, mode counters) and no deadlock
// (the counters keep growing between two checkpoints).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const files = readdirSync("src/constants/templates").filter((f) => f.endsWith(".json")).sort();
const index = (id) => files.findIndex((f) => f.endsWith(`-${id}.json`));
const run = (template, at) => {
  let out;
  // flow-check exits 1 on an AMR collision; keep its output so the check below reports it.
  try { out = execFileSync("node", ["scripts/flow-check.mjs", `--template=${template}`, `--at=${at}`, "--speed=8"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }); }
  catch (error) { out = String(error.stdout ?? ""); }
  const num = (key) => Number(out.match(new RegExp(`${key} (\\d+)`))?.[1] ?? NaN);
  return { depalletized: num("depalletized"), shipped: num("shippedBoxes"), emptyStacked: num("emptyStacked"), carrierTrips: num("carrierTrips"), scanTrips: num("scanTrips"), palletsFed: num("palletsFed"), minGap: out.match(/amrMinGap: ([\d.]+)m limit ([\d.]+)m[^\n]*/g)?.at(-1) ?? "", feedScan: JSON.parse(out.match(/feedScan: (\{.*\})/g)?.at(-1)?.slice(10) ?? "null") };
};
const cases = [
  { id: "pallet-cycle-inbound-forklift-empty", mode: "emptyStacked" },
  { id: "pallet-cycle-forklift-carrier", mode: "carrierTrips" },
  { id: "pallet-cycle-conveyor-pallet-feed", mode: "palletsFed" },
];
let failed = 0;
for (const { id, mode } of cases) {
  const t = index(id);
  if (t < 0) { console.error(`FAIL ${id}: template missing`); failed++; continue; }
  const early = run(t, 1200), late = run(t, 2400);
  const checks = [
    [`${mode} > 0`, late[mode] > 0],
    ["boxes shipped > 0", late.shipped > 0],
    ["depalletized > 0", late.depalletized > 0],
    [`no deadlock (${mode} ${early[mode]} → ${late[mode]})`, late[mode] > early[mode]],
    [`no deadlock (depalletized ${early.depalletized} → ${late.depalletized})`, late.depalletized > early.depalletized],
  ];
  checks.push([`AMR centres never closer than 2×radius (${late.minGap || "no pairs"})`, !/COLLISION/.test(late.minGap)]);
  if (mode === "palletsFed") checks.push([`empty pallets collected by forklift (${late.emptyStacked})`, late.emptyStacked > 0]);
  if (mode === "palletsFed") {
    const f = late.feedScan ?? { dropped: 0, bypass: 0, passed: 0, unscanned: 0, inTransit: 0 };
    // Boxes still tracked between pickup and the scanner at the snapshot are not a skip (unscanned counts those).
    checks.push([`inbound boxes 100% scanned (dropped ${f.dropped}, bypass ${f.bypass}, passed ${f.passed}, unscanned ${f.unscanned}, in transit ${f.inTransit ?? 0})`, f.dropped > 0 && f.passed <= f.dropped && f.dropped - f.passed <= (f.inTransit ?? 0) && f.bypass === 0 && f.unscanned === 0]);
  }
  if (mode === "carrierTrips") checks.push(["no shuttle feeds the depalletizer", late.scanTrips === 0]);
  const bad = checks.filter(([, ok]) => !ok);
  failed += bad.length;
  console.log(`${bad.length ? "FAIL" : "ok  "} ${id}: t=2400s ${mode} ${late[mode]}, depalletized ${late.depalletized}, shipped boxes ${late.shipped}`);
  for (const [name] of bad) console.log(`     ✗ ${name}`);
}
// AMR-AMR clearance on the other pallet-cycle templates (13–15 are checked above).
for (const id of ["pallet-cycle-rack-m", "pallet-cycle-pallet-inbound", "pallet-cycle-multi-line"]) {
  const t = index(id);
  if (t < 0) continue;
  const r = run(t, 1800);
  const ok = r.minGap && !/COLLISION/.test(r.minGap);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} AMR clearance ${id}: ${r.minGap || "no AMR pairs"}, shipped boxes ${r.shipped}`);
}
// No AMR lifts a pallet off the floor: in every pallet-cycle template the AMRs are shuttles (deck loaded by a
// service forklift or the inbound roller), AGVs or forklifts — no plain pallet AMR that drives under a floor pallet —
// and every template with shuttles has a service forklift to put empty pallets on their decks.
for (const file of files.filter((f) => f.includes("pallet-cycle"))) {
  const amrs = JSON.parse(readFileSync(`src/constants/templates/${file}`, "utf8")).equipment.filter((e) => e.kind === "amr").map((e) => e.settings ?? {});
  const floorLifters = amrs.filter((s) => !["shuttle", "agv", "forklift"].includes(s.amrRole)).length;
  const shuttles = amrs.filter((s) => s.amrRole === "shuttle").length;
  const service = amrs.some((s) => s.amrRole === "forklift" && s.forkliftTask === "service");
  const ok = floorLifters === 0 && (!shuttles || service);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} no AMR floor pickup: ${file} (floor-lifting AMRs ${floorLifters}, shuttles ${shuttles}, service forklift ${service ? "yes" : "no"})`);
}

// Runtime: no AMR ever lifts a floor pallet (FactorySimulator.floorLiftAttempts) and no dock holds two AMRs at once
// (flow-check's dockShare check) — across every template.
const flowOut = (extra) => {
  try { return execFileSync("node", ["scripts/flow-check.mjs", ...extra, "--speed=8"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }); }
  catch (error) { return String(error.stdout ?? ""); }
};
for (let t = 0; t < files.length; t++) {
  const out = flowOut([`--template=${t}`, "--at=600"]);
  const lift = Number(out.match(/floorLift: (\d+)/)?.[1] ?? NaN);
  const share = /dockShare: ok/.test(out);
  const ok = lift === 0 && share;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} runtime ${files[t]}: floorLiftAttempts ${lift}, ${out.match(/dockShare: \S+/)?.[0] ?? "dockShare: ?"}`);
}
// Headless repros built from a palletizing + depalletizing template (scripts/fixtures/forklift-*.json):
//  - no pallet AMR → the forklift carries the full pallet to the outbound robot (forkliftOutbound > 0)
//  - no forklift → '지게차 없음' warning, exactly once
//  - no robot and no AMR → '공정 흐름을 생성할 수 없음' warning, exactly once
const strip = (src, dest, drop) => {
  const t = JSON.parse(readFileSync(`src/constants/templates/${src}`, "utf8"));
  const keep = t.equipment.map((e, i) => !drop(e, i, t.equipment));
  const map = []; let n = 0; keep.forEach((k, i) => { map[i] = k ? n++ : -1; });
  t.equipment = t.equipment.filter((_, i) => keep[i]);
  t.links = (t.links ?? []).filter((l) => map[l.from] >= 0 && map[l.to] >= 0).map((l) => ({ ...l, from: map[l.from], to: map[l.to] }));
  mkdirSync("scripts/fixtures", { recursive: true });
  writeFileSync(`scripts/fixtures/${dest}`, JSON.stringify(t, null, 2));
  return `scripts/fixtures/${dest}`;
};
const depal = files.find((f) => f.includes("inbound-depal-scan-outbound"));
const isForklift = (e) => e.kind === "amr" && e.settings?.amrRole === "forklift";
const MISSING = "지게차 없음 · 바닥 팔레트 이동 불가", NO_FLOW = "공정 흐름을 생성할 수 없음";
const repros = [
  ["forklift-no-amr.json", (e) => e.kind === "amr" && !isForklift(e), (o) => [`forkliftOutbound > 0 (${o.match(/forkliftOutbound: (\d+)/g)?.at(-1)})`, Number(o.match(/forkliftOutbound: (\d+)/g)?.at(-1)?.split(" ")[1]) > 0]],
  ["forklift-missing.json", isForklift, (o) => [`'${MISSING}' warned once`, (o.match(/warnings: [^\n]*/)?.[0] ?? "").split(MISSING).length === 2]],
  ["no-flow.json", (e) => e.kind === "amr" || e.kind === "robot", (o) => [`'${NO_FLOW}' warned once`, (o.match(/warnings: [^\n]*/)?.[0] ?? "").split(NO_FLOW).length === 2]],
];
for (const [dest, drop, check] of repros) {
  const out = flowOut([`--file=${strip(depal, dest, drop)}`, "--at=600"]);
  const [name, ok] = check(out);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} repro ${dest}: ${name}`);
}
process.exit(failed ? 1 : 0);
