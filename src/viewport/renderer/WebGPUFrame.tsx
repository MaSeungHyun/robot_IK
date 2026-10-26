import { useFrame } from "@react-three/fiber";
import { NoToneMapping } from "three";
import type { BufferGeometry, InstancedBufferAttribute, InterleavedBufferAttribute, Material, Object3D } from "three";

type InstancedGeometry = BufferGeometry & { isInstancedBufferGeometry?: boolean; instanceCount: number };

/** Geometries whose instanceCount was left at three's default (Infinity); recomputed every frame. */
const autoCount = new WeakSet<BufferGeometry>();
let reportedError = false;

/**
 * WebGLRenderer clamps an InstancedBufferGeometry's default instanceCount (Infinity) to the smallest
 * instanced attribute, but WebGPURenderer passes it straight to drawIndexed, which throws every frame.
 * drei Line/Edges (LineSegmentsGeometry) rely on that default, so derive the real count here.
 */
function instancedCount(geometry: BufferGeometry) {
  let count = Infinity;
  for (const attribute of Object.values(geometry.attributes)) {
    const instanced = attribute as (InstancedBufferAttribute | InterleavedBufferAttribute) & {
      isInstancedBufferAttribute?: boolean;
      data?: { isInstancedInterleavedBuffer?: boolean };
    };
    if (instanced.isInstancedBufferAttribute || instanced.data?.isInstancedInterleavedBuffer) count = Math.min(count, attribute.count);
  }
  return Number.isFinite(count) ? count : 0;
}

const TEXTURE_SLOTS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "bumpMap", "lightMap", "envMap",
] as const;
/** Which texture slots each material was last built with (bit mask). */
const slotMask = new WeakMap<Material, number>();

/**
 * WebGLRenderer re-checks texture presence every frame, but WebGPURenderer keeps the node graph it built,
 * so a map switched to null later (R3F prop `map={cond ? null : texture}`) crashes TextureNode.update.
 * Rebuild the material whenever the set of present texture slots changes.
 */
function syncTextureSlots(material: Material) {
  const slots = material as unknown as Record<string, unknown>;
  let mask = 0;
  for (let i = 0; i < TEXTURE_SLOTS.length; i++) if (slots[TEXTURE_SLOTS[i]]) mask |= 1 << i;
  const previous = slotMask.get(material);
  if (previous !== undefined && previous !== mask) material.needsUpdate = true;
  slotMask.set(material, mask);
}

function sanitize(object: Object3D) {
  const material = (object as Object3D & { material?: Material | Material[] }).material;
  if (Array.isArray(material)) material.forEach(syncTextureSlots);
  else if (material) syncTextureSlots(material);
  const geometry = (object as Object3D & { geometry?: InstancedGeometry }).geometry;
  if (geometry?.isInstancedBufferGeometry) {
    if (!Number.isFinite(geometry.instanceCount)) autoCount.add(geometry);
    if (autoCount.has(geometry)) geometry.instanceCount = instancedCount(geometry);
  }
  const mesh = object as Object3D & { isInstancedMesh?: boolean; count: number };
  if (mesh.isInstancedMesh && !Number.isFinite(mesh.count)) mesh.count = 0;
}

/**
 * Under WebGPU there is no EffectComposer (pmndrs postprocessing is WebGL-only), but several useFrame
 * callbacks use positive priorities, which turns R3F's automatic render off. Render at the composer's
 * priority (1) instead, so the frame order stays the same.
 */
export default function WebGPUFrame() {
  useFrame(({ gl, scene, camera }) => {
    // WebGL draws into the composer's render target, so three never tone-maps there and the composer
    // adds none: the WebGL picture is untone-mapped. R3F sets ACESFilmic, which WebGPU would apply to the
    // whole frame (and to the outline/ribbons, which ignore toneMapped there). Match WebGL instead.
    if (gl.toneMapping !== NoToneMapping) gl.toneMapping = NoToneMapping;
    scene.traverseVisible(sanitize);
    try {
      gl.render(scene, camera);
    } catch (error) {
      // One bad draw must not kill the frame loop; log once instead of every frame.
      if (!reportedError) console.error("[WebGPU] render failed", error);
      reportedError = true;
    }
  }, 1);
  return null;
}