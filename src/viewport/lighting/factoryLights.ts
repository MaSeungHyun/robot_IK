import { DirectionalLight, Object3D, SpotLight, Vector3 } from "three";
import type { ShadowQuality } from "@/stores/useViewportSettingsStore";

/**
 * The factory.glb light rig (KHR_lights_punctual, Blender-matched intensities), shared by FactoryLighting and the
 * startup warm-up: shader programs depend on the light count / types / shadow casters, so compiling with this exact
 * rig at startup means switching to the factory lighting reuses every program instead of recompiling.
 */
/** One knob for the whole rig (spots + sun); 1 = the Blender-matched values below. */
export const LIGHT_SCALE = 1.0;
const RULES: { match: RegExp; intensity: number; shadow: boolean }[] = [
  { match: /^HighBay_\d+$/, intensity: 201.3, shadow: false },
  { match: /^Process_Key_\d+$/, intensity: 146.4, shadow: true },
  { match: /^Dock_Daylight$/, intensity: 477.5, shadow: true },
  { match: /^Sun$/, intensity: 1.0, shadow: true },
];
/** Sun: moved back along its own direction so the ±80 m ortho shadow box (near 0.5, far 400) covers the hall. */
const SUN_BACK = 200;
const SHADOW = { bias: -0.0003, normalBias: 0.03, radius: 4 };

export type FactoryLight = SpotLight | DirectionalLight;

/** New lights (with targets) built from the factory.glb scene's punctual lights. */
export function buildFactoryLights(scene: Object3D): FactoryLight[] {
  scene.updateMatrixWorld(true);
  const out: (SpotLight | DirectionalLight)[] = [];
  const from = new Vector3(), to = new Vector3();
  scene.traverse((object) => {
    const source = object as SpotLight | DirectionalLight;
    if (!source.isLight || !("target" in source)) return;
    const rule = RULES.find((r) => r.match.test(source.name));
    if (!rule) return;
    source.getWorldPosition(from);
    source.target.getWorldPosition(to);
    const light = (source as SpotLight).isSpotLight
      ? new SpotLight(source.color, rule.intensity * LIGHT_SCALE, (source as SpotLight).distance, (source as SpotLight).angle, (source as SpotLight).penumbra, (source as SpotLight).decay)
      : new DirectionalLight(source.color, rule.intensity * LIGHT_SCALE);
    light.name = source.name;
    light.userData.shadow = rule.shadow;
    const target = new Object3D();
    if ((light as DirectionalLight).isDirectionalLight) {
      target.position.set(0, 0, 0);
      light.position.subVectors(from, to).normalize().multiplyScalar(SUN_BACK);
    } else {
      target.position.copy(to);
      light.position.copy(from);
    }
    (light as SpotLight).target = target;
    out.push(light);
  });
  return out;
}

/** Shadow flags / map sizes per quality: "low" keeps only the sun shadow (2048), "off" drops every shadow map. */
export function applyShadowQuality(lights: readonly FactoryLight[], quality: ShadowQuality) {
  for (const light of lights) {
    const sun = (light as DirectionalLight).isDirectionalLight;
    const cast = light.userData.shadow && quality !== "off" && (sun || quality === "high");
    light.castShadow = cast;
    if (!cast || !light.shadow) continue;
    const shadow = light.shadow;
    const size = sun ? (quality === "high" ? 4096 : 2048) : 2048;
    if (shadow.mapSize.x !== size) {
      shadow.mapSize.set(size, size);
      shadow.map?.dispose();
      shadow.map = null;
    }
    Object.assign(shadow, SHADOW);
    if (sun) {
      const camera = (light as DirectionalLight).shadow.camera;
      camera.left = -80; camera.right = 80; camera.top = 80; camera.bottom = -80;
      camera.near = 0.5; camera.far = 400;
      camera.updateProjectionMatrix();
    }
    shadow.needsUpdate = true;
  }
}
