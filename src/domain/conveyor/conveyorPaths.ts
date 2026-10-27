/**
 * Spline ("path") conveyors: a glb rail drawn whole, with boxes following the belt centreline extracted from its
 * `conveyorbelt` mesh. Centrelines below are in the conveyor entity's local frame (entity pose = the glb node's
 * translation, yaw 0), +z/forward = sin/cos(yaw) like straight belts.
 *  - rail_c (rail_c.glb / factory.glb "rail_c"): belt strips centred on x = 5.42 (z -12.56..-3.55), z = -1.375,
 *    x = -5.42 (z 0.80..12.56); both corners are 90° arcs of radius ≈ 2.17 (strip ends 2.15–2.18 m from the corner).
 *  - rail.001 (factory.glb, node mirrored: world = t + (-x, y, z)): strips at x = 3.785 (z -16.37..-7.35),
 *    z = -5.18, x = -7.05 (z -3.0..8.75); same corner radius. Points here are already mirrored (x negated).
 * Flow runs from the first point to the last: from the robot side (z max, the scanner exit) toward z min.
 */
export type ConveyorPathId = "rail_c" | "rail_001";

type Sample = { x: number; z: number; yaw: number; s: number };
const RADIUS = 2.17;
const CORNERS: Record<ConveyorPathId, readonly (readonly [number, number])[]> = {
  rail_c: [[-5.42, 12.56], [-5.42, -1.375], [5.42, -1.375], [5.42, -12.56]],
  rail_001: [[7.05, 8.75], [7.05, -5.18], [-3.785, -5.18], [-3.785, -16.37]],
};

function build(corners: readonly (readonly [number, number])[]) {
  const pts: [number, number][] = [[...corners[0]] as [number, number]];
  for (let i = 1; i < corners.length - 1; i++) {
    const [px, pz] = corners[i - 1], [cx, cz] = corners[i], [nx, nz] = corners[i + 1];
    const ax = px - cx, az = pz - cz, al = Math.hypot(ax, az), bx = nx - cx, bz = nz - cz, bl = Math.hypot(bx, bz);
    const ux = ax / al, uz = az / al, vx = bx / bl, vz = bz / bl;
    // 90° corners: fillet tangent points at RADIUS along each leg, arc centre at their diagonal.
    const sx = cx + ux * RADIUS, sz = cz + uz * RADIUS, ox = sx + vx * RADIUS, oz = sz + vz * RADIUS;
    const a0 = Math.atan2(sz - oz, sx - ox), a1 = Math.atan2(cz + vz * RADIUS - oz, cx + vx * RADIUS - ox);
    let da = a1 - a0; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= 24; k++) { const a = a0 + da * k / 24; pts.push([ox + RADIUS * Math.cos(a), oz + RADIUS * Math.sin(a)]); }
  }
  pts.push([...corners[corners.length - 1]] as [number, number]);
  const out: Sample[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const [ax, az] = pts[Math.max(0, i - 1)], [bx, bz] = pts[Math.min(pts.length - 1, i + 1)];
    out.push({ x: pts[i][0], z: pts[i][1], yaw: Math.atan2(bx - ax, bz - az), s });
  }
  return out.filter((p, i) => i === 0 || p.s - out[i - 1].s > 1e-6);
}
const PATHS = Object.fromEntries(Object.entries(CORNERS).map(([id, c]) => [id, build(c)])) as Record<ConveyorPathId, Sample[]>;

/** Centreline polyline points (local frame), read-only. */
export const pathPoints = (id: ConveyorPathId): readonly { x: number; z: number }[] => PATHS[id];

export const pathLength = (id: ConveyorPathId) => PATHS[id][PATHS[id].length - 1].s;

/** Local point/tangent at arc length `distance` (clamped; straight legs keep their exact yaw). */
export function pathLocalPoint(id: ConveyorPathId, distance: number) {
  const p = PATHS[id], d = Math.max(0, Math.min(distance, p[p.length - 1].s));
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].s <= d) lo = m; else hi = m; }
  const a = p[lo], b = p[hi], t = (d - a.s) / (b.s - a.s || 1);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
}

/** Distance from a local point to the centreline. */
// Segments grouped in chunks with a bounding box: a chunk farther than the best distance so far is skipped (exact result).
const CHUNK = 6;
const CHUNKS = Object.fromEntries(Object.entries(PATHS).map(([id, p]) => {
  const out: { from: number; to: number; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  for (let i = 1; i < p.length; i += CHUNK) {
    const to = Math.min(p.length - 1, i + CHUNK - 1), pts = p.slice(i - 1, to + 1);
    out.push({ from: i, to, minX: Math.min(...pts.map((q) => q.x)), maxX: Math.max(...pts.map((q) => q.x)), minZ: Math.min(...pts.map((q) => q.z)), maxZ: Math.max(...pts.map((q) => q.z)) });
  }
  return [id, out];
})) as Record<ConveyorPathId, { from: number; to: number; minX: number; maxX: number; minZ: number; maxZ: number }[]>;
export function pathDistance(id: ConveyorPathId, lx: number, lz: number) {
  const p = PATHS[id];
  let best2 = Infinity;
  for (const c of CHUNKS[id]) {
    const ox = Math.max(c.minX - lx, 0, lx - c.maxX), oz = Math.max(c.minZ - lz, 0, lz - c.maxZ);
    if (ox * ox + oz * oz >= best2) continue;
    for (let i = c.from; i <= c.to; i++) {
      const ax = p[i - 1].x, az = p[i - 1].z, dx = p[i].x - ax, dz = p[i].z - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((lx - ax) * dx + (lz - az) * dz) / l2));
      const ex = lx - ax - dx * t, ez = lz - az - dz * t, d2 = ex * ex + ez * ez;
      if (d2 < best2) best2 = d2;
    }
  }
  return Math.sqrt(best2);
}

/** Local bounding box of the centreline (for coarse layout/collision rects). */
export function pathBounds(id: ConveyorPathId) {
  const p = PATHS[id];
  return { minX: Math.min(...p.map((q) => q.x)), maxX: Math.max(...p.map((q) => q.x)), minZ: Math.min(...p.map((q) => q.z)), maxZ: Math.max(...p.map((q) => q.z)) };
}