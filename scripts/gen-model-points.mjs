// Reads interaction points straight from the authored GLBs (no scaling) and writes
// src/constants/modelPoints.generated.ts so the headless simulator (pick-sim, workers) can use them.
// Re-run after replacing Rack.glb, pallet.glb, box.glb, AMR.glb, rail.glb, ScanTunnel.glb or Forklift.glb:  node scripts/gen-model-points.mjs
// The app also re-reads the same nodes at load and warns if the GLB and this file disagree.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => {
  const buffer = fs.readFileSync(path.join(root, "src/assets/models", file));
  return JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
};
const clean = (name) => name.replace(/\.\d+$/, "").toLowerCase();
const bounds = (gltf, node) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of gltf.meshes[node.mesh].primitives) {
    const accessor = gltf.accessors[primitive.attributes.POSITION];
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], accessor.min[i]); max[i] = Math.max(max[i], accessor.max[i]); }
  }
  return { min, max };
};
const round = (v) => Math.round(v * 1e4) / 1e4;
const t = (node) => (node.translation ?? [0, 0, 0]).map(round);
const assertPlain = (node) => {
  if (node.rotation && node.rotation.some((v, i) => Math.abs(v - (i === 3 ? 1 : 0)) > 1e-6)) throw new Error(`${node.name}: rotation is not identity`);
  if (node.scale && node.scale.some((v) => Math.abs(v - 1) > 1e-6)) throw new Error(`${node.name}: scale is not 1`);
};

// Rack: slot empties "<level><L|R>_point" (level 1 may omit the number), any prefix such as "Rack_", Blender ".001" suffixes ignored.
const rack = read("Rack.glb");
const rackRoot = rack.nodes[rack.scenes[0].nodes[0]];
assertPlain(rackRoot);
const slots = [];
for (const index of rackRoot.children ?? []) {
  const node = rack.nodes[index];
  const parts = clean(node.name).split("_");
  if (parts.at(-1) !== "point") continue;
  // Numbered: "1L_point", "1_point", "1R_point", "2L_point" ... (any prefix). Unnumbered: "Rack_L_point",
  // "Rack_point", "Rack_R_point", "Rack_NL_point" / "Rack_N_point" / "Rack_NR_point" reused on every upper level.
  const token = parts.length > 1 ? parts.at(-2) : "";
  const match = /^(\d*)n?([lr]?)$/.exec(token) ?? /^()()$/.exec("");
  assertPlain(node);
  const [x, y, z] = t(node);
  slots.push({ name: node.name, number: match[1] ? +match[1] : null, level: 0, column: match[2] ? match[2].toUpperCase() : "C", x, y, z });
}
// Prefer authored level numbers when every slot has one; otherwise levels are ranked by height (1 = lowest).
const numbered = slots.length > 0 && slots.every((s) => s.number !== null);
const heights = [...new Set(slots.map((s) => Math.round(s.y * 100)))].sort((a, b) => a - b);
for (const s of slots) { s.level = numbered ? s.number : heights.indexOf(Math.round(s.y * 100)) + 1; delete s.number; }
const scheme = numbered ? "numbered" : "by height";
const columnOrder = { L: 0, C: 1, R: 2 };
slots.sort((a, b) => a.level - b.level || columnOrder[a.column] - columnOrder[b.column]);
const rackBounds = bounds(rack, rackRoot);

// Forklift: root "Forklift" > fork node "Forklift.Fork" (or "Fork") > empty "Forklift_point" (or "Forklit_point").
const forklift = read("Forklift.glb");
const find = (gltf, parent, test) => (parent.children ?? []).map((i) => gltf.nodes[i]).find((n) => test(clean(n.name)));
const body = forklift.nodes[forklift.scenes[0].nodes[0]];
const fork = find(forklift, body, (n) => /(^|[._])fork$/.test(n));
const point = fork && find(forklift, fork, (n) => /^fork?li?f?t_point$/.test(n) || n.endsWith("_point"));
if (!fork || !point) throw new Error("Forklift.glb: fork node or Forklift_point not found");
[body, fork, point].forEach(assertPlain);
const forkBounds = bounds(forklift, fork), bodyBounds = bounds(forklift, body);

// Pallet: mesh bounds only (used as authored; STREAM_CONFIG pallet dimensions come from these).
const pallet = read("pallet.glb");
const palletBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const index of pallet.scenes[0].nodes) {
  const node = pallet.nodes[index];
  assertPlain(node);
  if (node.mesh === undefined) continue;
  const b = bounds(pallet, node), o = node.translation ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) { palletBounds.min[i] = Math.min(palletBounds.min[i], b.min[i] + o[i]); palletBounds.max[i] = Math.max(palletBounds.max[i], b.max[i] + o[i]); }
}

// Conveyor rail (rail.glb) and scan tunnel (ScanTunnel.glb): belt surfaces come from the "conveyorbelt" material vertices.
const readBin = (file) => {
  const buffer = fs.readFileSync(path.join(root, "src/assets/models", file));
  const jsonLength = buffer.readUInt32LE(12);
  return buffer.subarray(20 + jsonLength + 8);
};
const positions = (gltf, bin, primitive) => {
  const accessor = gltf.accessors[primitive.attributes.POSITION], view = gltf.bufferViews[accessor.bufferView];
  const stride = view.byteStride ?? 12, offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), out = [];
  for (let i = 0; i < accessor.count; i++) out.push([0, 1, 2].map((k) => bin.readFloatLE(offset + i * stride + k * 4)));
  return out;
};
const meshNode = (gltf) => {
  const node = gltf.nodes[gltf.scenes[0].nodes.find((i) => gltf.nodes[i].mesh !== undefined)];
  assertPlain(node);
  return node;
};
const beltVertices = (gltf, bin, node) => gltf.meshes[node.mesh].primitives
  .filter((p) => clean(gltf.materials[p.material]?.name ?? "") === "conveyorbelt").flatMap((p) => positions(gltf, bin, p));
const rail = read("rail.glb"), railNode = meshNode(rail), railBounds = bounds(rail, railNode);
const railBelt = beltVertices(rail, readBin("rail.glb"), railNode);
if (!railBelt.length) throw new Error("rail.glb: conveyorbelt material not found");
const span = (vs, k) => [Math.min(...vs.map((v) => v[k])), Math.max(...vs.map((v) => v[k]))];
const tunnel = read("ScanTunnel.glb"), tunnelNode = meshNode(tunnel), tunnelBounds = bounds(tunnel, tunnelNode);
const tunnelBelt = beltVertices(tunnel, readBin("ScanTunnel.glb"), tunnelNode);
if (!tunnelBelt.length) throw new Error("ScanTunnel.glb: conveyorbelt material not found");
const [tunnelBeltZ0, tunnelBeltZ1] = span(tunnelBelt, 2);
// Belt top at the entry (min z) and exit (max z) ends of the tunnel's own belt.
const beltTopAt = (z) => Math.max(...tunnelBelt.filter((v) => Math.abs(v[2] - z) < 1e-3).map((v) => v[1]));
const scanPoint = (tunnelNode.children ?? []).map((i) => tunnel.nodes[i]).find((n) => clean(n.name).endsWith("_point"));
if (!scanPoint) throw new Error("ScanTunnel.glb: *_point empty not found");
assertPlain(scanPoint);

// Whole-scene bounds with node TRS applied (accessor min/max corners), for models used only by size.
const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const trs = (n) => {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
};
const sceneBounds = (file) => {
  const gltf = read(file), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const visit = (index, parent) => {
    const node = gltf.nodes[index], m = mul(parent, trs(node));
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
      const a = gltf.accessors[primitive.attributes.POSITION];
      for (let c = 0; c < 8; c++) {
        const v = [c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2]];
        for (let i = 0; i < 3; i++) { const w = m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i]; min[i] = Math.min(min[i], w); max[i] = Math.max(max[i], w); }
      }
    }
    for (const child of node.children ?? []) visit(child, m);
  };
  for (const index of gltf.scenes[0].nodes) visit(index, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return { min: min.map(round), max: max.map(round) };
};
const boxBounds = sceneBounds("box.glb"), amrBounds = sceneBounds("AMR.glb");
// RobotArm.glb base: the fixed base plus the turret (hand00) that yaws about +Y, so its floor footprint is the
// circle swept by the turret/base bounds corners about the origin.
const robotBaseRadius = (() => {
  const gltf = read("RobotArm.glb");
  let radius = 0;
  const visit = (index, parent) => {
    const node = gltf.nodes[index], m = mul(parent, trs(node)), name = clean(node.name);
    if (node.mesh !== undefined && (name === "base" || name === "hand00")) for (const primitive of gltf.meshes[node.mesh].primitives) {
      const a = gltf.accessors[primitive.attributes.POSITION];
      for (let c = 0; c < 8; c++) {
        const v = [c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2]];
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        radius = Math.max(radius, Math.hypot(x, z));
      }
    }
    if (name !== "hand00") for (const child of node.children ?? []) visit(child, m);
  };
  for (const index of gltf.scenes[0].nodes) visit(index, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (!radius) throw new Error("RobotArm.glb: base/hand00 meshes not found");
  return round(radius);
})();

const out = `// Generated by scripts/gen-model-points.mjs from Rack.glb, pallet.glb, box.glb, AMR.glb, RobotArm.glb, rail.glb, ScanTunnel.glb and Forklift.glb. Do not edit by hand.
// Model units are metres and the models are used exactly as authored (no scaling).

export const RACK_MODEL = {
  /** Rack mesh bounds in rack-local space (origin at the floor centre). */
  min: ${JSON.stringify(rackBounds.min.map(round))} as [number, number, number],
  max: ${JSON.stringify(rackBounds.max.map(round))} as [number, number, number],
  /** Slot empties, level 1 = bottom; column L/C/R. Position is the pallet's bottom centre (y = shelf). */
  slots: ${JSON.stringify(slots, null, 2).replace(/\n/g, "\n  ")} as { name: string; level: number; column: "L" | "C" | "R"; x: number; y: number; z: number }[],
};

export const PALLET_MODEL = {
  /** Pallet mesh bounds as authored (x = width, y = height, z = depth). */
  min: ${JSON.stringify(palletBounds.min.map(round))} as [number, number, number],
  max: ${JSON.stringify(palletBounds.max.map(round))} as [number, number, number],
};

export const BOX_MODEL = {
  /** Box scene bounds as authored (node transforms applied; x = width, y = height, z = depth). */
  min: ${JSON.stringify(boxBounds.min)} as [number, number, number],
  max: ${JSON.stringify(boxBounds.max)} as [number, number, number],
};

export const AMR_MODEL = {
  /** AMR scene bounds as authored (node transforms applied). */
  min: ${JSON.stringify(amrBounds.min)} as [number, number, number],
  max: ${JSON.stringify(amrBounds.max)} as [number, number, number],
};

export const ROBOT_MODEL = {
  /** Floor radius swept by the RobotArm.glb base + turret (hand00) about the robot origin. */
  baseRadius: ${robotBaseRadius},
};

export const RAIL_MODEL = {
  /** Rail mesh bounds in mesh-local space (belt runs along z; the node pivot is ignored, bottom goes on the floor). */
  min: ${JSON.stringify(railBounds.min.map(round))} as [number, number, number],
  max: ${JSON.stringify(railBounds.max.map(round))} as [number, number, number],
  /** Belt surface ("conveyorbelt" vertices): top y and x/z extent in mesh-local space. */
  beltTop: ${round(span(railBelt, 1)[1])},
  beltX: ${JSON.stringify(span(railBelt, 0).map(round))} as [number, number],
  beltZ: ${JSON.stringify(span(railBelt, 2).map(round))} as [number, number],
};

export const SCAN_TUNNEL_MODEL = {
  /** Tunnel mesh bounds in mesh-local space (flow along +z: entry at min z, exit at max z). */
  min: ${JSON.stringify(tunnelBounds.min.map(round))} as [number, number, number],
  max: ${JSON.stringify(tunnelBounds.max.map(round))} as [number, number, number],
  /** Own belt: z extent, top y at the entry and exit ends, x extent (mesh-local). */
  beltZ: [${round(tunnelBeltZ0)}, ${round(tunnelBeltZ1)}] as [number, number],
  beltX: ${JSON.stringify(span(tunnelBelt, 0).map(round))} as [number, number],
  entryBeltTop: ${round(beltTopAt(tunnelBeltZ0))},
  exitBeltTop: ${round(beltTopAt(tunnelBeltZ1))},
  /** Scan empty ${JSON.stringify(scanPoint.name)} in mesh-local space. */
  pointNode: ${JSON.stringify(scanPoint.name)},
  point: ${JSON.stringify(t(scanPoint))} as [number, number, number],
};

export const FORKLIFT_MODEL = {
  forkNode: ${JSON.stringify(fork.name)},
  pointNode: ${JSON.stringify(point.name)},
  /** Body mesh bounds (forklift-local, forward = +Z). */
  bodyMin: ${JSON.stringify(bodyBounds.min.map(round))} as [number, number, number],
  bodyMax: ${JSON.stringify(bodyBounds.max.map(round))} as [number, number, number],
  /** Fork node rest position in the forklift frame; it lifts along +Y. */
  fork: ${JSON.stringify(t(fork))} as [number, number, number],
  /** Fork mesh bounds in fork-local space (tines reach max z). */
  forkMin: ${JSON.stringify(forkBounds.min.map(round))} as [number, number, number],
  forkMax: ${JSON.stringify(forkBounds.max.map(round))} as [number, number, number],
  /** Forklift_point in fork-local space: where the pallet's fork-hole centre sits. */
  point: ${JSON.stringify(t(point))} as [number, number, number],
};
`;
fs.writeFileSync(path.join(root, "src/constants/modelPoints.generated.ts"), out.replace(/\n/g, "\r\n"));
console.log(`rack slots ${slots.length}:`, slots.map((s) => `${s.name}(L${s.level}${s.column} ${s.x},${s.y},${s.z})`).join(" "));
console.log("forklift:", fork.name, point.name, t(fork), t(point), forkBounds);