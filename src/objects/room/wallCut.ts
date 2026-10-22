import { BufferGeometry, Float32BufferAttribute } from "three";
import type { WallOpening } from "@/domain/room/roomWalls";
import type { RoomBeam } from "./RoomFrame";

export type WallRect = { x0: number; x1: number; y0: number; y1: number };

/** Sorted, merged openings (overlapping cuts become one with the higher top). */
function merged(openings: WallOpening[]) {
  const sorted = [...openings].sort((a, b) => a.x0 - b.x0);
  const result: WallOpening[] = [];
  for (const o of sorted) {
    const last = result.at(-1);
    if (last && o.x0 <= last.x1) { last.x1 = Math.max(last.x1, o.x1); last.top = Math.max(last.top, o.top); }
    else result.push({ ...o });
  }
  return result;
}

/** The band [y0, y1] of a wall `length` long, minus the openings (doors start at the floor). */
export function cutBand(length: number, y0: number, y1: number, openings: WallOpening[]): WallRect[] {
  const rects: WallRect[] = [];
  let x = -length / 2;
  for (const o of merged(openings)) {
    if (o.x0 > x) rects.push({ x0: x, x1: o.x0, y0, y1 });
    if (o.top < y1) rects.push({ x0: o.x0, x1: o.x1, y0: Math.max(y0, o.top), y1 });
    x = Math.max(x, o.x1);
  }
  if (x < length / 2) rects.push({ x0: x, x1: length / 2, y0, y1 });
  return rects.filter((r) => r.x1 - r.x0 > 1e-4 && r.y1 - r.y0 > 1e-4);
}

/**
 * One +Z-facing geometry for all rects (one draw call). UVs are the rect's position within the
 * whole `length` × `height` wall, so world-scale texture repeats stay continuous across the cuts.
 */
export function rectsGeometry(rects: WallRect[], length: number, height: number) {
  const position: number[] = [], uv: number[] = [], normal: number[] = [], index: number[] = [];
  for (const r of rects) {
    const base = position.length / 3;
    for (const [x, y] of [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]) {
      position.push(x, y, 0);
      uv.push((x + length / 2) / length, y / height);
      normal.push(0, 0, 1);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setIndex(index);
  return geometry;
}

/** Frame members around openings: verticals inside a cut start above it, horizontals below its top are split. */
export function clipBeams(beams: RoomBeam[], openings: WallOpening[]): RoomBeam[] {
  if (!openings.length) return beams;
  const cuts = merged(openings);
  const result: RoomBeam[] = [];
  for (const beam of beams) {
    const [ax, ay, az] = beam.from, [bx, by, bz] = beam.to, margin = beam.thickness / 2;
    if (Math.abs(ax - bx) < 1e-6) {
      let low = Math.min(ay, by);
      const high = Math.max(ay, by);
      for (const o of cuts) if (ax > o.x0 - margin && ax < o.x1 + margin) low = Math.max(low, o.top);
      if (high - low > 1e-3) result.push({ ...beam, from: [ax, low, az], to: [bx, high, bz] });
    } else if (Math.abs(ay - by) < 1e-6) {
      let x = Math.min(ax, bx);
      const end = Math.max(ax, bx);
      for (const o of cuts) {
        if (o.top <= ay - margin || o.x1 <= x || o.x0 >= end) continue;
        if (o.x0 - x > 1e-3) result.push({ ...beam, from: [x, ay, az], to: [o.x0, by, bz] });
        x = Math.max(x, o.x1);
      }
      if (end - x > 1e-3) result.push({ ...beam, from: [x, ay, az], to: [end, by, bz] });
    } else result.push(beam);
  }
  return result;
}