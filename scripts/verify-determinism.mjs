// Determinism check: node scripts/verify-determinism.mjs [seconds] [--templates=0,5,11] [--speeds=1,10]
// Runs each template headless at every speed for the same simulated time and compares a state hash
// (every node pose under the world root and robot models, plus counters) and the KPI report hash. Exit 1 on mismatch.
import { createHash } from "node:crypto";
import { openHarness } from "./lib/headlessSim.mjs";
const args = process.argv.slice(2);
const seconds = Number(args.find(a => !a.startsWith("--")) ?? 300);
const list = (name, fallback) => (args.find(a => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback).split(",").map(Number);
const templates = list("templates", "0,5,11"), speeds = list("speeds", "1,10");
const harness = await openHarness();
const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
let failed = false;
try {
  const fmt = (v) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6);
  const poses = (root, out) => root.traverse((o) => { out.push(o.name, o.visible ? 1 : 0, ...o.position.toArray().map(fmt), ...o.quaternion.toArray().map(fmt)); });
  for (const index of templates) {
    const hashes = [], kpis = [];
    for (const speed of speeds) {
      const { world, models, clock, template, ms } = harness.run(index, seconds, speed);
      const state = [clock.stats.simTime.toFixed(6), world.stats.spawned, world.placed, world.passed, world.stats.completedPallets,
        ...[...world.inspection.sensors.values()].flatMap(s => [s.snapshot.scanned, s.snapshot.faults]),
        ...models.map(m => m.controller.phase)];
      poses(world.root, state);
      for (const m of models) poses(m.model, state);
      const hash = digest(state.join("|")), kpi = digest(JSON.stringify(world.kpi.report()));
      hashes.push(hash); kpis.push(kpi);
      console.log(`template ${String(index + 1).padStart(2, "0")} ${template.name ?? ""} · ${speed}x · ${seconds}s sim · ${ms.toFixed(0)}ms · spawned ${world.stats.spawned} placed ${world.placed} · state ${hash} · kpi ${kpi}`);
    }
    const same = hashes.every(h => h === hashes[0]) && kpis.every(h => h === kpis[0]);
    if (!same) failed = true;
    console.log(`  => ${same ? "MATCH" : "MISMATCH"}`);
  }
} finally {
  await harness.close();
}
process.exit(failed ? 1 : 0);