// Validate a chunked recording: on-pallet box world pos vs parent pallet pose + rotated local; animated parts (if present).
// node scripts/validate-recording.mjs <runDir>
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2], rot = (l, yaw) => [l[0] * Math.cos(yaw) + l[2] * Math.sin(yaw), l[1], -l[0] * Math.sin(yaw) + l[2] * Math.cos(yaw)];
const err = (w, p, yaw, l) => { const r = rot(l, yaw); return Math.hypot(p[0] + r[0] - w[0], p[1] + r[1] - w[1], p[2] + r[2] - w[2]); };
const stat = (name, a) => { a.sort((x, y) => x - y); const at = (q) => a[Math.floor(q * (a.length - 1))] ?? 0, over = a.filter((v) => v > 0.05).length;
  console.log(`${name}: n=${a.length} mean ${(a.reduce((s, v) => s + v, 0) / Math.max(1, a.length) * 100).toFixed(2)}cm p99 ${(at(0.99) * 100).toFixed(2)}cm max ${(at(1) * 100).toFixed(2)}cm >5cm ${over}`); return { n: a.length, p99: at(0.99), max: at(1), over5cm: over }; };
const out = {};
for (const f of readdirSync(dir).filter((f) => /^chunk-\d+\.json$/.test(f)).sort()) {
  const c = JSON.parse(readFileSync(join(dir, f), "utf8")), s = c.snapshot, rec = c.recording;
  const pose = new Map(s.pallets.filter((p) => p[4]).map((p) => [p[0], [p[4], p[5] ?? 0]]));
  const snapE = [], world = new Map(), parent = new Map(); let missing = 0;
  for (const b of s.boxes) { world.set(b[0], [b[3] / 100, b[4] / 100, b[5] / 100]); if (b[1] !== "pallet") continue;
    const p = pose.get(b[2]); if (!p || b.length < 13) { missing++; continue; }
    const l = [b[10] / 100, b[11] / 100, b[12] / 100]; parent.set(b[0], [b[2], l]); snapE.push(err(world.get(b[0]), p[0], p[1], l)); }
  console.log(`${f}: snapshot on-pallet boxes ${snapE.length + missing} (no pallet pose/local: ${missing})`);
  out[f] = { snapshot: stat("  snapshot", snapE) };
  const evs = [...rec.pallets.map((e) => [e[0], 0, e]), ...rec.boxParents.map((e) => [e[0], 1, e]), ...rec.boxKeyframes.map((e) => [e.t, 2, e])].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const keyE = [], attE = [], pending = new Set(); const bad = []; let attaches = 0, attNoPose = 0, worst = null;
  for (const [, k, e] of evs) {
    if (k === 0) { if (e[4]) pose.set(e[1], [e[4], e[5] ?? 0]); }
    else if (k === 1) { if (e[2] === "pallet") { parent.set(e[1], [e[3], e[4]]); pending.add(e[1]); attaches++; } else { parent.delete(e[1]); pending.delete(e[1]); } }
    else { for (const [id, x, y, z] of e.boxes) world.set(id, [x, y, z]);
      for (const [id, [pid, l]] of parent) { const p = pose.get(pid), w = world.get(id); if (!w) continue; if (!p) { if (pending.has(id)) attNoPose++; pending.delete(id); continue; }
        const v = err(w, p[0], p[1], l); keyE.push(v); if (v > 0.05 && process.env.VDEBUG) bad.push([e.t, id, pid, +v.toFixed(3)]); if (pending.has(id)) { attE.push(v); pending.delete(id); if (!worst || v > worst[0]) worst = [v, id, pid, e.t]; } } }
  }
  console.log(`  pallet attaches ${attaches} unchecked ${pending.size} (no pallet pose: ${attNoPose}) worst ${JSON.stringify(worst)}`);
  if (process.env.VDEBUG) { const by = {}; for (const b of bad) by[b[2]] = (by[b[2]] ?? 0) + 1; console.log(by, JSON.stringify(bad.slice(0, 8))); }
  out[f].attach = stat("  attach (first keyframe after)", attE); out[f].keyframes = stat("  keyframes (all on-pallet samples)", keyE);
}
// Animated parts (manifest.animatedParts + chunk tracks.parts / snapshot.parts); skipped for older runs.
const mf = join(dir, "manifest.json"), manifest = existsSync(mf) ? JSON.parse(readFileSync(mf, "utf8")) : null;
if (manifest?.animatedParts) {
  const specs = manifest.animatedParts, dim = (sp) => sp.channel === "quat" ? 4 : 1, errs = [], byKind = {}, range = {};
  specs.forEach((sp, i) => { if (sp.i !== i) errs.push(`spec index ${i}`); if (!sp.deviceId || !sp.partName || !sp.channel || !sp.unit || !(sp.threshold > 0)) errs.push(`spec ${i} incomplete`); byKind[sp.kind] = (byKind[sp.kind] ?? 0) + 1; });
  const okVal = (sp, v) => dim(sp) === 4 ? Array.isArray(v) && v.length === 4 && Math.abs(Math.hypot(...v) - 1) < 2e-3 : typeof v === "number" && Number.isFinite(v);
  let rows = 0;
  for (const f of readdirSync(dir).filter((f) => /^chunk-\d+\.json$/.test(f)).sort()) {
    const c = JSON.parse(readFileSync(join(dir, f), "utf8")), sv = c.snapshot.parts, tr = c.tracks.parts;
    if (!Array.isArray(sv) || !Array.isArray(tr)) { errs.push(`${f}: missing snapshot.parts / tracks.parts`); continue; }
    if (!c.tracks.amrs || !c.tracks.joints) errs.push(`${f}: legacy tracks missing`);
    sv.forEach((v, i) => { if (v !== null && !okVal(specs[i], v)) errs.push(`${f}: snapshot part ${i} bad value`); });
    const last = sv.slice(); let tPrev = -Infinity;
    for (const [t, i, v] of tr) { rows++; const sp = specs[i];
      if (!sp) { errs.push(`${f}: row part ${i} undeclared`); continue; }
      if (t < tPrev || t < c.meta.t0 - 1e-6 || t > c.meta.t1 + 1e-6) errs.push(`${f}: row t ${t} out of order/range`); tPrev = t;
      if (!okVal(sp, v)) errs.push(`${f}: part ${i} bad value ${JSON.stringify(v)}`);
      if (JSON.stringify(last[i]) === JSON.stringify(v)) errs.push(`${f}: part ${i} duplicate value at ${t}`); last[i] = v;
      if (dim(sp) === 1) { const k = `${sp.kind}:${sp.partName}:${sp.channel}`, r = range[k] ?? (range[k] = [Infinity, -Infinity, 0]); r[0] = Math.min(r[0], v); r[1] = Math.max(r[1], v); r[2]++; } }
  }
  out.parts = { specs: specs.length, byKind, rows, errors: errs.length, range };
  console.log(`animated parts: ${specs.length} declared ${JSON.stringify(byKind)} rows ${rows} errors ${errs.length}`, errs.slice(0, 10));
  for (const [k, r] of Object.entries(range)) console.log(`  ${k}: min ${r[0]} max ${r[1]} rows ${r[2]}`);
}
console.log("JSON", JSON.stringify(out));
