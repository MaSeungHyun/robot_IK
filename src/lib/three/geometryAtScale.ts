import type { BufferGeometry } from "three";

const scaledGeometries = new WeakMap<BufferGeometry, Map<number, BufferGeometry>>();

/** Scaled copy of a geometry, cached per source and scale (shared by every robot). */
export function geometryAtScale(source: BufferGeometry, scale: number) {
  let scales = scaledGeometries.get(source);
  if (!scales) {
    scales = new Map();
    scaledGeometries.set(source, scales);
  }
  let geometry = scales.get(scale);
  if (!geometry) {
    geometry = source.clone();
    geometry.scale(scale, scale, scale);
    scales.set(scale, geometry);
  }
  return geometry;
}
