// Extract XZ footprints of factory.glb prop parts AMRs must not drive through (columns, fences, barriers, guardrails,
// static pallets, racks): triangles below 1.5 m are split into connected pieces, each piece's box in the node's yaw frame,
// overlapping boxes merged. Output: src/constants/propFootprints.ts.  Run: node scripts/prop-colliders.mjs
import fs from "node:fs";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
await MeshoptDecoder.ready;
const buf = fs.readFileSync("src/constants/templates/factory.glb");
const jsonLen = buf.readUInt32LE(12);
const gl = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
const bin = buf.subarray(20 + jsonLen + 8);
const views = new Map();
const view = (i) => {
  if (views.has(i)) return views.get(i);
  const bv = gl.bufferViews[i], ext = bv.extensions?.EXT_meshopt_compression;
  let out;
  if (ext) {
    out = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset ?? 0), ext.byteLength), ext.mode, ext.filter ?? "NONE");
  } else out = new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0), bv.byteLength).slice();
  views.set(i, out);
  return out;
};
const read = (ai) => {
  const a = gl.accessors[ai], bv = gl.bufferViews[a.bufferView], raw = view(a.bufferView);
  const n = { SCALAR: 1, VEC3: 3 }[a.type], stride = bv.byteStride ?? (a.componentType === 5126 ? 4 * n : a.componentType === 5125 ? 4 * n : 2 * n);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), res = new Float64Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const o = (a.byteOffset ?? 0) + k * stride + c * (a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1);
    res[k * n + c] = a.componentType === 5126 ? dv.getFloat32(o, true) : a.componentType === 5125 ? dv.getUint32(o, true) : a.componentType === 5123 ? dv.getUint16(o, true) : dv.getUint8(o);
  }
  return res;
};
const parent = new Map();
gl.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const local = (n) => n.matrix ? new THREE.Matrix4().fromArray(n.matrix)
  : new THREE.Matrix4().compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
const world = (i) => { const m = local(gl.nodes[i]); for (let p = parent.get(i); p !== undefined; p = parent.get(p)) m.premultiply(local(gl.nodes[p])); return m; };
const SOLID = /^(column|fence|barrier|guardrail|pallet|prop_pallet|Rack\.|Prop_Rack)/;
const MAX_Y = 1.5, r = (v) => Math.round(v * 1000) / 1000;
const out = {};
gl.nodes.forEach((n, i) => {
  if (!n.name || !SOLID.test(n.name) || (parent.has(i) && SOLID.test(gl.nodes[parent.get(i)].name ?? ""))) return;
  const W0 = world(i), q = new THREE.Quaternion(); W0.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  const yaw = new THREE.Euler().setFromQuaternion(q, "YXZ").y, toFrame = new THREE.Matrix4().makeRotationY(-yaw);
  let boxes = [];
  const visit = (k) => {
    const nd = gl.nodes[k], W = world(k);
    if (nd.mesh !== undefined) for (const prim of gl.meshes[nd.mesh].primitives) {
      const pos = read(prim.attributes.POSITION), count = pos.length / 3;
      const idx = prim.indices !== undefined ? read(prim.indices) : Float64Array.from({ length: count }, (_, k) => k);
      const P = []; for (let v = 0; v < count; v++) P.push(new THREE.Vector3(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]).applyMatrix4(W));
      const up = Int32Array.from({ length: count }, (_, k) => k), find = (x) => { while (up[x] !== x) x = up[x] = up[up[x]]; return x; };
      for (let t = 0; t < idx.length; t += 3) { const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]); up[b] = a; up[c] = a; }
      const pieces = new Map();
      for (let v = 0; v < count; v++) {
        const root = find(v); let p = pieces.get(root);
        if (!p) pieces.set(root, (p = { box: new THREE.Box3(), low: Infinity, h: -Infinity }));
        p.low = Math.min(p.low, P[v].y); p.h = Math.max(p.h, P[v].y);
        if (P[v].y < MAX_Y) p.box.expandByPoint(P[v].clone().applyMatrix4(toFrame).setY(0));
      }
      for (const p of pieces.values()) if (p.low < MAX_Y && p.h > 0.05 && !p.box.isEmpty()) boxes.push({ box: p.box, h: p.h });
    }
    (nd.children ?? []).forEach(visit);
  };
  visit(i);
  // Merge touching / overlapping pieces (posts + rails of one fence run, rack uprights + beams).
  for (let merged = true; merged;) {
    merged = false;
    for (let a = 0; a < boxes.length && !merged; a++) for (let b = a + 1; b < boxes.length; b++) {
      if (boxes[a].box.clone().expandByScalar(0.05).intersectsBox(boxes[b].box)) { boxes[a].box.union(boxes[b].box); boxes[a].h = Math.max(boxes[a].h, boxes[b].h); boxes.splice(b, 1); merged = true; break; }
    }
  }
  const rot = new THREE.Matrix4().makeRotationY(yaw);
  const parts = boxes.map(({ box, h }) => {
    const c = new THREE.Vector3((box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2).applyMatrix4(rot);
    return { x: r(c.x), z: r(c.z), yaw: r(yaw), w: r(Math.max(0.05, box.max.x - box.min.x)), d: r(Math.max(0.05, box.max.z - box.min.z)), h: r(h) };
  });
  if (parts.length) out[n.name] = parts;
});
const fmt = (p) => `{ ${Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(", ")} }`;
const body = `/** Generated by scripts/prop-colliders.mjs from factory.glb: XZ footprints (centre, yaw, width x / depth z in that yaw, top h)
 * of the parts of solid template props (columns, fences, barriers, guardrails, static pallets and racks) below 1.5 m. The
 * simulator turns the props a template lists into AMR / forklift route obstacles. Re-run the script after changing factory.glb. */
export type PropFootprint = { x: number; z: number; yaw: number; w: number; d: number; h: number };
export const PROP_FOOTPRINTS: Readonly<Record<string, readonly PropFootprint[]>> = {
${Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: [\n${v.map((p) => `    ${fmt(p)},`).join("\n")}\n  ],`).join("\n")}
};
`;
fs.writeFileSync("src/constants/propFootprints.ts", body.replace(/\r?\n/g, "\r\n"), "utf8");
for (const [k, v] of Object.entries(out)) console.log(k, v.length, v.slice(0, 3).map(fmt).join(" "));