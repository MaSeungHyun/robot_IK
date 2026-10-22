import { Box3, BoxGeometry, BufferGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Low-poly stand-in (deck + 3 runners, 48 triangles) for the 4,254-triangle pallet mesh, in the same local
 * frame and bounds. SceneInstances swaps a pallet to it once the pallet is static (stored in a rack), see
 * `geometry.userData.lowPoly`. Only position/normal/uv are produced, matching what the material uses.
 */
export function createLowPolyPallet(source: BufferGeometry): BufferGeometry {
  source.computeBoundingBox();
  const box = source.boundingBox ?? new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
  const size = box.getSize(new Vector3());
  const part = (w: number, h: number, d: number, x: number, y: number, z: number) => new BoxGeometry(w, h, d).translate(x, y, z);
  const deckH = size.y * 0.35, runnerW = size.z * 0.14, cx = (box.min.x + box.max.x) / 2;
  const parts = [part(size.x, deckH, size.z, cx, box.max.y - deckH / 2, (box.min.z + box.max.z) / 2)];
  for (const z of [box.min.z + runnerW / 2, (box.min.z + box.max.z) / 2, box.max.z - runnerW / 2])
    parts.push(part(size.x, size.y - deckH, runnerW, cx, box.min.y + (size.y - deckH) / 2, z));
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()), false) ?? parts[0];
  for (const p of parts) if (p !== merged) p.dispose();
  merged.userData.instanceGeometryKey = `${source.uuid}:low`;
  return merged;
}
