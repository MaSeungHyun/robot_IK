import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  Vector3,
  type BufferAttribute as Attribute,
  type InterleavedBufferAttribute,
  type Material,
  type Object3D,
} from "three";
import type { ConveyorRole, ConveyorTurn } from "@/types/layout";
import { PALLET_CONVEYOR } from "@/constants/palletConveyor";
import { CONVEYOR_LAYOUT as C } from "@/constants/conveyorLayoutConfig";
import { beltLength, beltLocalPoint } from "@/domain/conveyor/conveyorLayout";

const templates = new Map<string, Group>();
const bodyMaterial = new MeshStandardMaterial({ color: "#475569" });
const stripeMaterial = new MeshStandardMaterial({ color: "#fbbf24" });
const legMaterial = new MeshStandardMaterial({ color: "#334155" });
/** Outbound (출하) markings are red; flat (no emissive glow). */
const SHIP_RED = "#e5484d";
const accentMaterial = new MeshStandardMaterial({ color: SHIP_RED, roughness: 0.8 });
const padMaterial = new MeshStandardMaterial({ color: SHIP_RED, transparent: true, opacity: 0.45 });
/** Edit-mode flow arrow colours by conveyor role: 입하 mint, 출하 red, ordinary belts (incl. rail_c / rail.001) white. */
export const CONVEYOR_ARROW_COLORS = { normal: "#e4e4e7", inbound: "#02dfef", outbound: SHIP_RED } as const;
type ArrowKind = keyof typeof CONVEYOR_ARROW_COLORS;
const arrowMaterials = Object.fromEntries(
  Object.entries(CONVEYOR_ARROW_COLORS).map(([kind, color]) => [kind, new MeshStandardMaterial({ color, roughness: 0.8 })]),
) as Record<ArrowKind, MeshStandardMaterial>;
const arrowKind = (role: ConveyorRole): ArrowKind => (shipsOut(role) ? "outbound" : role === "inbound" ? "inbound" : "normal");
/** Flat chevron pointing along +z (belt flow), `size` m wide. */
function chevron(size: number) {
  const shape = new Shape(), w = size / 2, t = size * 0.22;
  shape.moveTo(-w, 0);
  shape.lineTo(0, w * 0.8);
  shape.lineTo(w, 0);
  shape.lineTo(w, -t);
  shape.lineTo(0, w * 0.8 - t);
  shape.lineTo(-w, -t);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
  // Shape XY -> floor XZ (shape +Y = belt +Z).
  geometry.rotateX(Math.PI / 2);
  return geometry;
}
function shipsOut(role: ConveyorRole) { return role === "outbound" || role === "ship"; }
const arrowGeometry = chevron(C.beltWidth * 0.55);
const arrowTemplates = new Map<string, Group>();
/**
 * Flow arrows centred on the belt (every conveyor, like the former outbound chevrons), kept out of the
 * instanced belt template so the editor can hide them during Play. Red on outbound / ship belts.
 * Shared geometry/materials: callers clone the group.
 */
export function conveyorArrows(turn: ConveyorTurn = "straight", role: ConveyorRole = "box") {
  const key = `${turn}:${arrowKind(role)}`;
  let group = arrowTemplates.get(key);
  if (group) return group;
  group = new Group();
  const material = arrowMaterials[arrowKind(role)];
  const top = C.height + 0.008;
  const length = turn === "straight" ? C.length : beltLength({ x: 0, z: 0, yaw: 0, conveyorTurn: turn });
  const count = Math.max(1, Math.round(length / 4));
  for (let i = 0; i < count; i++) {
    const s = (length * (i + 0.5)) / count;
    const mark = new Mesh(arrowGeometry, material);
    if (turn === "straight") mark.position.set(0, top, s - length / 2);
    else {
      const p = beltLocalPoint({ conveyorTurn: turn }, s);
      mark.position.set(p.x, top, p.z);
      mark.rotation.y = p.yaw;
    }
    group.add(mark);
  }
  arrowTemplates.set(key, group);
  return group;
}
/**
 * Flow arrows along any belt given its local sampler (distance -> point/yaw along the flow), at height `top`:
 * used for glb belts (rail_in_out.glb straight, rail_c / rail.001 splines). New group per call (cheap, few meshes).
 */
export function flowArrows(length: number, top: number, role: ConveyorRole, at: (s: number) => { x: number; z: number; yaw: number }) {
  const group = new Group(), material = arrowMaterials[arrowKind(role)];
  const count = Math.max(1, Math.round(length / 4));
  for (let i = 0; i < count; i++) {
    const p = at((length * (i + 0.5)) / count), mark = new Mesh(arrowGeometry, material);
    mark.position.set(p.x, top, p.z);
    mark.rotation.y = p.yaw;
    group.add(mark);
  }
  return group;
}
/** Outbound (출하) belt markings on a straight rail.glb (the rail itself is untouched): red side stripes and the AMR transfer pad. */
function roleAccents(role: ConveyorRole, template: Group) {
  const half = C.length / 2, top = C.height + 0.008;
  if (role !== "outbound") return;
  for (const side of [-1, 1]) {
    const stripe = new Mesh(new BoxGeometry(0.06, 0.02, C.length * 0.96), accentMaterial);
    stripe.position.set(side * (C.width / 2 - 0.03), top, 0);
    template.add(stripe);
  }
  // AMR docking / transfer pad (on the floor, in front of the belt start).
  const pad = new Mesh(new BoxGeometry(C.width, 0.006, 0.12), padMaterial);
  pad.position.set(0, 0.004, -half - PALLET_CONVEYOR.transferOffset + 1.25);
  template.add(pad);
}
/** rail.glb as authored, pivot centred on the belt path with its bottom on the floor (same for straights and bent turns). */
function centredRail(rail: Object3D) {
  const asset = rail.clone(true);
  for (const child of asset.children) child.position.set(0, 0, 0);
  const bounds = new Box3().setFromObject(asset), center = bounds.getCenter(new Vector3());
  asset.position.set(-center.x, -bounds.min.y, -center.z);
  return asset;
}
/** Max length (m, along the belt) of a triangle edge before it is split for bending. */
const BEND_STEP = 0.06;
type Vertex = number[][];
/**
 * Keeps the middle |z| <= half of a straight rail (non-indexed), splitting triangles until no edge spans more than
 * BEND_STEP along z (every attribute interpolated) so the piece can be bent smoothly.
 */
function sliceAlongZ(geometry: BufferGeometry, start: number, count: number, half: number) {
  const names = Object.keys(geometry.attributes);
  const attrs = names.map((n) => geometry.attributes[n] as Attribute | InterleavedBufferAttribute);
  const zOf = (v: Vertex) => v[names.indexOf("position")][2];
  const read = (i: number): Vertex => attrs.map((a) => Array.from({ length: a.itemSize }, (_, k) => a.getComponent(i, k)));
  const mid = (a: Vertex, b: Vertex): Vertex => a.map((values, j) => values.map((value, k) => (value + b[j][k]) / 2));
  const out: Vertex[] = [];
  const stack: [Vertex, Vertex, Vertex, number][] = [];
  for (let i = start; i + 2 < start + count; i += 3) stack.push([read(i), read(i + 1), read(i + 2), 0]);
  while (stack.length) {
    const [a, b, c, depth] = stack.pop()!;
    const ab = Math.abs(zOf(a) - zOf(b)), bc = Math.abs(zOf(b) - zOf(c)), ca = Math.abs(zOf(c) - zOf(a));
    const longest = Math.max(ab, bc, ca), zs = [zOf(a), zOf(b), zOf(c)];
    if (Math.min(...zs) > half || Math.max(...zs) < -half) continue;
    if (longest <= BEND_STEP || depth > 16) { if (Math.abs((zs[0] + zs[1] + zs[2]) / 3) <= half) out.push(a, b, c); continue; }
    if (longest === ab) { const m = mid(a, b); stack.push([a, m, c, depth + 1], [m, b, c, depth + 1]); }
    else if (longest === bc) { const m = mid(b, c); stack.push([a, b, m, depth + 1], [a, m, c, depth + 1]); }
    else { const m = mid(c, a); stack.push([a, b, m, depth + 1], [m, b, c, depth + 1]); }
  }
  const result = new BufferGeometry();
  names.forEach((name, j) => {
    const size = attrs[j].itemSize, array = new Float32Array(out.length * size);
    out.forEach((v, i) => array.set(v[j], i * size));
    result.setAttribute(name, new BufferAttribute(array, size, attrs[j].normalized));
  });
  return result;
}
/** Maps a straight rail slice (local z in [-length/2, length/2] along the flow, 1:1) onto a 90° turn centreline, rotating normals with it. */
function bend(geometry: BufferGeometry, turn: ConveyorTurn) {
  const length = beltLength({ conveyorTurn: turn }), straight = length;
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const start = beltLocalPoint({ conveyorTurn: turn }, 0), end = beltLocalPoint({ conveyorTurn: turn }, length);
  const along = (d: number) => {
    if (d <= 0) return { x: start.x + Math.sin(start.yaw) * d, z: start.z + Math.cos(start.yaw) * d, yaw: start.yaw };
    if (d >= length) { const e = d - length; return { x: end.x + Math.sin(end.yaw) * e, z: end.z + Math.cos(end.yaw) * e, yaw: end.yaw }; }
    return beltLocalPoint({ conveyorTurn: turn }, d);
  };
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const p = along(((z + straight / 2) / straight) * length), c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    position.setXYZ(i, p.x + x * c, position.getY(i), p.z - x * s);
    if (normal) { const nx = normal.getX(i), nz = normal.getZ(i); normal.setXYZ(i, nx * c + nz * s, normal.getY(i), -nx * s + nz * c); }
  }
  position.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
/** A 90° turn built from rail.glb itself (same model/materials/scale as the straight belt): a turn-length slice of it, bent along the turn centreline. */
function bentRail(turn: ConveyorTurn, rail: Object3D) {
  const holder = new Group();
  holder.add(centredRail(rail));
  holder.updateMatrixWorld(true);
  const group = new Group();
  holder.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const flat = source.index ? source.toNonIndexed() : source;
    const total = flat.attributes.position.count;
    const ranges = flat.groups.length ? flat.groups : [{ start: 0, count: total, materialIndex: 0 }];
    for (const range of ranges) {
      const geometry = sliceAlongZ(flat, range.start, Math.min(range.count, total - range.start), beltLength({ conveyorTurn: turn }) / 2);
      if (!geometry.attributes.position?.count) continue;
      bend(geometry, turn);
      const material = Array.isArray(mesh.material) ? (mesh.material[range.materialIndex ?? 0] as Material) : mesh.material;
      const bent = new Mesh(geometry, material);
      bent.castShadow = mesh.castShadow;
      bent.receiveShadow = mesh.receiveShadow;
      group.add(bent);
    }
  });
  return group;
}
// Turns without rail.glb loaded fall back to a procedural ribbon at the rail's width with the belt at the rail's belt height.
const bodyDepth = 0.025;
const legGeometry = new BoxGeometry(C.beltWidth * 0.7, C.height - bodyDepth, 0.08);
function ribbon(turn: ConveyorTurn, width: number, depth: number) {
  const length = beltLength({ x: 0, z: 0, yaw: 0, conveyorTurn: turn });
  const samples = Array.from({ length: C.samples + 1 }, (_, i) =>
    beltLocalPoint({ conveyorTurn: turn }, (length * i) / C.samples),
  );
  const edge = (side: number) =>
    samples.map((p) => ({
      x: p.x + ((Math.cos(p.yaw) * width) / 2) * side,
      y: -(p.z - ((Math.sin(p.yaw) * width) / 2) * side),
    }));
  const outline = [...edge(1), ...edge(-1).reverse()],
    shape = new Shape();
  outline.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, p.y);
    else shape.lineTo(p.x, p.y);
  });
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
}
/** Immutable shared geometry/materials: clones only retain independent transforms. */
export function conveyorTemplate(turn: ConveyorTurn = "straight", rail?: Object3D, role: ConveyorRole = "box") {
  const accented = turn === "straight" && role === "outbound";
  const key = `${turn === "straight" && rail ? "rail" : rail ? `${turn}:rail` : turn}${accented ? `:${role}` : ""}`;
  let template = templates.get(key);
  if (template) return template;
  template = new Group();
  if (turn === "straight" && rail) {
    // rail.glb as authored: only its pivot is moved so the mesh is centred on the belt path with its bottom on the floor.
    template.add(centredRail(rail));
    if (accented) roleAccents(role, template);
    templates.set(key, template);
    return template;
  }
  if (rail) {
    // Left/right turns: the same rail.glb design as the straight belt, bent (no separate turn asset).
    template.add(bentRail(turn, rail));
    templates.set(key, template);
    return template;
  }
  const body = new Mesh(ribbon(turn, C.width, bodyDepth), bodyMaterial);
  body.rotation.x = -Math.PI / 2;
  body.position.y = C.height - bodyDepth;
  template.add(body);
  const stripe = new Mesh(ribbon(turn, C.beltWidth, 0.001), stripeMaterial);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.y = C.height;
  template.add(stripe);
  const length = beltLength({ x: 0, z: 0, yaw: 0, conveyorTurn: turn });
  for (const t of [0.15, 0.85]) {
    const p = beltLocalPoint({ conveyorTurn: turn }, length * t),
      leg = new Mesh(legGeometry, legMaterial);
    leg.position.set(p.x, (C.height - bodyDepth) / 2, p.z);
    leg.rotation.y = p.yaw;
    template.add(leg);
  }
  if (accented) roleAccents(role, template);
  templates.set(key, template);
  return template;
}
