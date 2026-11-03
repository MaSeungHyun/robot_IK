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
// KPI stream (manifest.kpiSchema + chunk tracks.kpi / snapshot.kpi): schema conformance + count invariants; skipped for older runs.
if (manifest?.kpiSchema) {
  const sch = manifest.kpiSchema, errs = [], E = (m) => { if (errs.length < 200) errs.push(m); };
  const decl = sch.keys.map((k) => ({ ...k, re: new RegExp("^" + k.key.replace(/\./g, "\\.").replace(/<[^>]+>/g, "[^.]+") + "$"), hit: 0 }));
  const flat = (o, pre = "", acc = []) => { for (const [k, v] of Object.entries(o)) { const key = pre ? `${pre}.${k}` : k; if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, acc); else acc.push([key, v]); } return acc; };
  const typeOk = (ty, v) => ty === "int" ? Number.isInteger(v) && v >= 0 : ty === "number" ? typeof v === "number" && Number.isFinite(v) : ty === "string" ? typeof v === "string" : ty === "number|null" ? v === null || (typeof v === "number" && Number.isFinite(v)) : false;
  const pct = (v) => v === null || (v >= -1e-6 && v <= 100 + 1e-6);
  let rows = 0, prev = null, tPrev = -Infinity; const firstLast = {};
  const check = (f, s) => {
    const kv = flat(s);
    for (const [key, v] of kv) { const d = decl.find((x) => x.re.test(key)); if (!d) { E(`${f} t=${s.t}: undeclared key ${key}`); continue; } d.hit++; if (!typeOk(d.type, v)) E(`${f} t=${s.t}: ${key}=${JSON.stringify(v)} not ${d.type}`); if (d.unit === "%" && typeof v === "number" && !pct(v)) E(`${f} t=${s.t}: ${key}=${v} outside 0-100`); if (/\/(h|min)$/.test(d.unit) && v < 0) E(`${f} t=${s.t}: ${key} negative`); }
    const st = s.stages, c = (k) => st[k].count, sc = s.scan, tag = `${f} t=${s.t}`;
    if (c("inbound") < c("depalletize")) E(`${tag}: inbound < depalletize`);
    if (sc.scanners > 0) { if (c("depalletize") < sc.scanned) E(`${tag}: depal < scanned`); if (sc.scanned < c("palletize") + s.boxes.passed) E(`${tag}: scanned < placed+passed`); }
    if (sc.pass + sc.defect !== sc.scanned) E(`${tag}: pass+defect != scanned`);
    if (sc.scanners > 0) { const by = Object.values(sc.byScanner ?? {}); if (by.length !== sc.scanners) E(`${tag}: byScanner count`); const n = by.reduce((a, x) => a + x.scanned, 0), d = by.reduce((a, x) => a + x.defect, 0); if (n !== sc.scanned || d !== sc.defect) E(`${tag}: per-scanner sum ${n}/${d} != ${sc.scanned}/${sc.defect}`); }
    if (c("scan") !== sc.scanned) E(`${tag}: stages.scan.count != scan.scanned`);
    if (s.throughput.processed !== c("palletize")) E(`${tag}: processed != palletize`);
    if (!(c("ship") <= c("outbound") && c("outbound") <= c("rackStore") && c("rackStore") <= s.pallets.full)) E(`${tag}: ship<=outbound<=rackStore<=full violated ${c("ship")}/${c("outbound")}/${c("rackStore")}/${s.pallets.full}`);
    let boxWip = 0; for (const [k, x] of Object.entries(st)) { if (x.wip < 0) E(`${tag}: ${k}.wip < 0`); if (!pct(x.progress)) E(`${tag}: ${k}.progress`); if (["inbound", "depalletize", "scan", "palletize"].includes(k)) boxWip += x.wip; }
    if (s.wip.boxes < 0 || s.wip.pallets < 0 || s.wip.boxes > c("inbound") || boxWip > c("inbound")) E(`${tag}: wip bounds`);
    const r = s.rack; if (r.stored + r.reserved > r.slots) E(`${tag}: rack stored+reserved > slots`); if (r.slots && Math.abs(r.occupancy - r.stored / r.slots * 100) > 0.11) E(`${tag}: rack occupancy inconsistent`);
    const vb = Object.values(s.vehicles.byId); if (vb.length !== s.vehicles.total || s.vehicles.busy > s.vehicles.total) E(`${tag}: vehicles counts`);
    for (const [id, x] of Object.entries(s.robots)) if (prev?.robots?.[id] && x.cycles < prev.robots[id].cycles) E(`${tag}: robot ${id} cycles decreased`);
    if (prev) { const pk = new Map(flat(prev)); for (const [key, v] of kv) { const d = decl.find((x) => x.re.test(key)); if (d?.type === "int" && /\.count$|^throughput\.processed$|^pallets\.full$|^boxes\.passed$|^scan\.(scanned|pass|defect)$|\.cycles$/.test(key) && pk.has(key) && v < pk.get(key)) E(`${tag}: ${key} decreased ${pk.get(key)} -> ${v}`); } }
  };
  for (const f of readdirSync(dir).filter((f) => /^chunk-\d+\.json$/.test(f)).sort()) {
    const ch = JSON.parse(readFileSync(join(dir, f), "utf8")), tr = ch.tracks.kpi, sk = ch.snapshot.kpi;
    if (!Array.isArray(tr) || !sk) { E(`${f}: missing tracks.kpi / snapshot.kpi`); continue; }
    if (!ch.tracks.parts || !ch.tracks.joints || !ch.tracks.amrs) E(`${f}: legacy tracks missing`);
    check(`${f} snapshot`, sk);
    for (const [t, s] of tr) { rows++; if (t !== s.t) E(`${f}: row t ${t} != sample t`); if (t <= tPrev || t < ch.meta.t0 - 1e-6 || t > ch.meta.t1 + 1e-6) E(`${f}: row t ${t} out of order/range`); if (tPrev > -Infinity && Math.abs(t - tPrev - 1) > 0.11) E(`${f}: gap ${tPrev} -> ${t}`); tPrev = t; check(f, s); prev = s; firstLast.first ??= s; firstLast.last = s; }
  }
  for (const d of decl) if (!d.hit && !(d.key.startsWith("scan.byScanner") && firstLast.last?.scan.scanners === 0)) E(`declared key never present: ${d.key}`);
  const a = firstLast.first, b = firstLast.last, win = a && b ? Object.fromEntries(Object.entries(b.stages).map(([k, x]) => [k, x.count - a.stages[k].count])) : null;
  out.kpi = { declared: decl.length, rows, errors: errs.length, window: win, scanned: b && b.scan.scanned - a.scan.scanned, defects: b && b.scan.defect - a.scan.defect };
  console.log(`kpi: ${decl.length} keys declared, rows ${rows}, errors ${errs.length}`, errs.slice(0, 10));
  if (win) console.log(`  window deltas ${JSON.stringify(win)} scanned ${out.kpi.scanned} defects ${out.kpi.defects}; day totals at end ${JSON.stringify(Object.fromEntries(Object.entries(b.stages).map(([k, x]) => [k, x.count])))}`);
}
console.log("JSON", JSON.stringify(out));
