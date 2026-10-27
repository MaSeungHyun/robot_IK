import { BufferGeometry, Float32BufferAttribute } from "three";

/**
 * Enviroment BG_Floor UV mapping, in world metres: u = 0.0503 + (x + 34.3226) * K, v = 0.9497 - |z| * K
 * (K = 0.8994 / 71.09 m; the glb floor is two quads mirrored at z = 0). The material's ×5 texture transform then
 * gives one tile per ~15.8 m, exactly like the glb. Floors anywhere sample the same world-space pattern.
 */
const K = 0.8994 / 71.0917;
const uvAt = (x: number, z: number) => [0.0503 + (x + 34.3226) * K, 0.9497 - Math.abs(z) * K];

/** Floor `width` × `depth` (local, y = 0 plane, centred) placed at world (x, z) with `yaw`; split at world z = 0 for the mirror. */
export function buildKitFloor(width: number, depth: number, pose: { x: number; z: number; yaw: number }): BufferGeometry {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  const world = (lx: number, lz: number) => [pose.x + lx * c + lz * s, pose.z - lx * s + lz * c];
  const xs = [-width / 2, width / 2];
  const zs = [-depth / 2, depth / 2];
  // Local z where world z crosses 0 (only meaningful when the floor is axis-aligned).
  if (Math.abs(s) < 1e-6) { const lz = -pose.z / c; if (lz > zs[0] && lz < zs[1]) zs.splice(1, 0, lz); }
  const position: number[] = [], uv: number[] = [], normal: number[] = [], index: number[] = [];
  for (let j = 0; j < zs.length; j++) for (let i = 0; i < 2; i++) {
    const [wx, wz] = world(xs[i], zs[j]);
    position.push(xs[i], 0, zs[j]); normal.push(0, 1, 0); uv.push(...uvAt(wx, wz));
  }
  for (let j = 0; j + 1 < zs.length; j++) { const a = j * 2; index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}