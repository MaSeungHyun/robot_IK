import { BufferGeometry, Float32BufferAttribute } from "three";
import type { WallOpening } from "@/domain/room/roomWalls";

/**
 * Factory wall kit: the inner-face bay module of factory.glb's "Enviroment" wall primitive (material "wall", see
 * kitMaterials.ts). UVs are the glb's raw (unflipped) values. Each bay is 6.75 m wide: a lower ribbed panel
 * (0..6 m) and an upper panel (6..12 m); UV rects are the glb's own (u runs right-to-left across a bay).
 * Walls are built by repeating bays along the length (stretched to fit), clipping door openings out of each rect.
 */
export const WALL_KIT = {
  bayWidth: 6.75,
  bands: [
    { y0: 0, y1: 6, u0: 0.952, u1: 0.665, v0: 0.521, v1: 0.264 },
    { y0: 6, y1: 12, u0: 0.952, u1: 0.665, v0: 0.264, v1: 0.008 },
  ],
} as const;

type Rect = { x0: number; x1: number; y0: number; y1: number };

/** rect minus openings (doors start at the floor and reach `top`). */
function subtract(rect: Rect, openings: readonly WallOpening[]): Rect[] {
  let pieces: Rect[] = [rect];
  for (const o of openings) {
    const next: Rect[] = [];
    for (const r of pieces) {
      if (o.x1 <= r.x0 || o.x0 >= r.x1 || o.top <= r.y0) { next.push(r); continue; }
      if (o.x0 > r.x0) next.push({ ...r, x1: o.x0 });
      if (o.x1 < r.x1) next.push({ ...r, x0: o.x1 });
      if (o.top < r.y1) next.push({ x0: Math.max(r.x0, o.x0), x1: Math.min(r.x1, o.x1), y0: o.top, y1: r.y1 });
    }
    pieces = next;
  }
  return pieces.filter((r) => r.x1 - r.x0 > 1e-4 && r.y1 - r.y0 > 1e-4);
}

/** +Z-facing wall `length` × `height` (local origin at bottom centre) in kit bays, with the openings cut out. */
export function buildKitWall(length: number, height: number, openings: readonly WallOpening[]): BufferGeometry {
  const bays = Math.max(1, Math.round(length / WALL_KIT.bayWidth));
  const bay = length / bays;
  const position: number[] = [], uv: number[] = [], normal: number[] = [], index: number[] = [];
  for (let i = 0; i < bays; i++) {
    const bx0 = -length / 2 + i * bay;
    for (const band of WALL_KIT.bands) {
      if (band.y0 >= height) continue;
      const top = Math.min(height, band.y1);
      for (const r of subtract({ x0: bx0, x1: bx0 + bay, y0: band.y0, y1: top }, openings)) {
        const base = position.length / 3;
        for (const [x, y] of [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]) {
          const fx = (x - bx0) / bay, fy = (y - band.y0) / (band.y1 - band.y0);
          position.push(x, y, 0);
          normal.push(0, 0, 1);
          uv.push(band.u0 + (band.u1 - band.u0) * fx, band.v0 + (band.v1 - band.v0) * fy);
        }
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}