/**
 * Render-only "drop-in" when an auto-layout is applied: the store already holds the final poses; each
 * equipment's inner render group starts DROP_IN.height above its spot and settles to y = 0 (linear),
 * staggered by kind (conveyor -> robot -> pallet -> rack/dock -> AMR) and, within a kind, nearest to the
 * flow start first, then a warp band reveal. Selection, gizmos and saved data use the outer group/store.
 */
import type { EquipmentKind, SceneEquipment } from "@/types/layout";
import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from "three";
import { AUTO_LAYOUT_DROP_IN as DROP_IN } from "@/constants/auto-layout";

export { DROP_IN };
const H = DROP_IN.hologram;
/**
 * ONE shared hologram material for every warping mesh (never disposed; originals restored at the end).
 * Per-object values (bbox height range, band progress, flash) are written by each mesh's onBeforeRender
 * with `uniformsNeedUpdate`, so staggered objects share one program and no material is cloned or recompiled.
 */
export const dropInMaterial = new ShaderMaterial({
  uniforms: {
    uColor: { value: new Color(H.color) },
    uMinY: { value: 0 },
    uHeight: { value: 1 },
    uBand: { value: -1 },
    uFlash: { value: 0 },
    uFade: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorld; varying vec3 vNormal; varying vec3 vView;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      vView = cameraPosition - world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uMinY; uniform float uHeight; uniform float uBand; uniform float uFlash; uniform float uFade;
    varying vec3 vWorld; varying vec3 vNormal; varying vec3 vView;
    void main() {
      float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), ${H.rimPower.toFixed(3)});
      float scan = step(0.5, fract(vWorld.y * ${H.scanDensity.toFixed(3)})) * ${H.scan.toFixed(3)};
      float h = (vWorld.y - uMinY) / max(uHeight, 1e-3);
      float band = uBand < 0.0 ? 0.0 : smoothstep(${H.bandWidth.toFixed(3)}, 0.0, abs(h - uBand));
      float a = (${H.opacity.toFixed(3)} + rim * ${H.rim.toFixed(3)} + scan) * uFade + band * ${H.band.toFixed(3)} + uFlash * ${H.flash.toFixed(3)};
      gl_FragColor = vec4(mix(uColor, vec3(1.0), clamp(band * 0.5 + uFlash * 0.6, 0.0, 1.0)) * a, 1.0);
    }`,
  transparent: true,
  blending: AdditiveBlending,
  depthWrite: false,
  side: DoubleSide,
});
const ORDER: Partial<Record<EquipmentKind, number>> = { conveyor: 0, robot: 1, scanner: 1, pallet: 2, rack: 3, dock: 3, amr: 4 };

/** id -> start time (performance.now() ms). Entries are removed by the render group when it is done. */
export const dropInSchedule = new Map<string, number>();
const total = DROP_IN.durationMs + DROP_IN.revealMs;

export function scheduleDropIn(objects: readonly SceneEquipment[], now = performance.now()) {
  dropInSchedule.clear();
  const animated = objects.filter((o) => ORDER[o.kind] !== undefined);
  const origin = animated.find((o) => o.kind === "conveyor") ?? { x: 0, z: 0 };
  const sorted = [...animated].sort((a, b) => ORDER[a.kind]! - ORDER[b.kind]! || Math.hypot(a.x - origin.x, a.z - origin.z) - Math.hypot(b.x - origin.x, b.z - origin.z));
  sorted.forEach((object, i) => dropInSchedule.set(object.id, now + i * DROP_IN.staggerMs));
  return sorted.length ? (sorted.length - 1) * DROP_IN.staggerMs + total : 0;
}

export type DropInFrame = { y: number; visible: boolean; band: number; flash: number; fade: number; done: boolean };
/** Render state for `id` at `now`; null when it is not (or no longer) animating. band < 0: still falling. */
export function dropInState(id: string, now: number, swapped = true): DropInFrame | null {
  const start = dropInSchedule.get(id);
  if (start === undefined) return null;
  const ms = now - start;
  if (!swapped) {
    // Without the material swap: plain linear drop with the short fallback duration.
    const t = ms / DROP_IN.fallbackDurationMs;
    if (t >= 1) return { y: 0, visible: true, band: -1, flash: 0, fade: 1, done: true };
    return { y: DROP_IN.height * (1 - Math.max(0, t)), visible: t > 0, band: -1, flash: 0, fade: 1, done: false };
  }
  if (ms <= 0) return { y: DROP_IN.height, visible: false, band: -1, flash: 0, fade: 1, done: false };
  if (ms < DROP_IN.durationMs) return { y: DROP_IN.height * (1 - ms / DROP_IN.durationMs), visible: true, band: -1, flash: 0, fade: 1, done: false };
  if (ms >= total) return { y: 0, visible: true, band: -1, flash: 0, fade: 1, done: true };
  const r = (ms - DROP_IN.durationMs) / DROP_IN.revealMs,
    flashStart = 1 - DROP_IN.flashMs / DROP_IN.revealMs,
    flash = r < flashStart ? 0 : Math.sin(((r - flashStart) / (1 - flashStart)) * Math.PI);
  return { y: 0, visible: true, band: r * 1.1, flash, fade: 1 - r * 0.6, done: false };
}
