import type { Vector3 } from "three";

/** A body following `path` at `speed` (m/s) and then parked at its end; `offsets` are extra circle centres
 * (world xz, translated with the path point; forklift footprint). */
export type SweptAgent = { path: readonly Vector3[]; speed: number; radius: number; offsets?: readonly { x: number; z: number }[] };
const ORIGIN = [{ x: 0, z: 0 }];
/** Point `distance` m along `path` (clamped to its end). */
export function pointAlong(path: readonly Vector3[], distance: number) {
  let left = distance;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      length = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= length) {
      const t = length ? left / length : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    left -= length;
  }
  const end = path[path.length - 1];
  return { x: end.x, z: end.z };
}
export function polylineLength(path: readonly Vector3[]) {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return length;
}
/**
 * Space-time check of a joint plan: both agents move along their paths simultaneously; sampled every `step` s up to
 * `horizon` s, no circle pair may come closer than radii + margin (a pair already closer at t = 0 may only open).
 * Fixed sample times, no wall clock: deterministic. Cost: (horizon / step) x circle pairs distance tests.
 */
export function sweptClear(a: SweptAgent, b: SweptAgent, horizon: number, step: number, margin: number) {
  const oa = a.offsets ?? ORIGIN,
    ob = b.offsets ?? ORIGIN,
    limit = a.radius + b.radius + margin,
    start: number[] = [],
    steps = Math.ceil(horizon / step);
  for (let n = 0; n <= steps; n++) {
    const t = n * step,
      pa = pointAlong(a.path, a.speed * t),
      pb = pointAlong(b.path, b.speed * t);
    let k = 0;
    for (const u of oa)
      for (const v of ob) {
        const d = Math.hypot(pa.x + u.x - pb.x - v.x, pa.z + u.z - pb.z - v.z);
        if (n === 0) start[k] = d;
        else if (d < Math.min(limit, start[k]) - 1e-6) return false;
        k++;
      }
  }
  return true;
}
