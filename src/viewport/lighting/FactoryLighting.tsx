import { Suspense, useEffect, useLayoutEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Object3D,
  PCFShadowMap,
  SpotLight,
  type Mesh,
} from "three";
import { useGLTF } from "@/lib/three/gltfLoader";
import { selectShadowQuality, useViewportSettingsStore } from "@/stores/useViewportSettingsStore";
import { isWebGPURenderer } from "@/viewport/renderer/createRenderer";
import factoryGlbUrl from "@/constants/templates/factory.glb?url";
import { useTemplateLoadStore } from "@/stores/useTemplateLoadStore";
import { applyShadowQuality, buildFactoryLights } from "@/viewport/lighting/factoryLights";

/**
 * Blender look for the "factory" lighting templates: the factory.glb KHR_lights_punctual lights (authored transforms,
 * cone angles/penumbra/decay) with Blender-matched intensities, (HDR environment + AgX tone mapping: SceneEnvironment).
 * The glb stores W converted to candela (e.g. 119573 cd); three's physically based units need these values instead.
 */
export { LIGHT_SCALE } from "@/viewport/lighting/factoryLights";
/** How often new meshes (spawned boxes, AMRs, ...) are switched to cast/receive shadows. */
const SHADOW_SWEEP_S = 1;

function GlbLights() {
  const quality = useViewportSettingsStore(selectShadowQuality);
  const { scene } = useGLTF(factoryGlbUrl) as unknown as { scene: Object3D };
  const lights = useMemo(() => buildFactoryLights(scene), [scene]);
  // Low-quality fallback: "low" keeps only the sun shadow (2048), "off" drops every shadow map.
  useLayoutEffect(() => applyShadowQuality(lights, quality), [lights, quality]);

  return (
    <>
      {lights.map((light) => (
        <group key={light.uuid}>
          <primitive object={light} />
          <primitive object={(light as SpotLight).target} />
        </group>
      ))}
    </>
  );
}

/**
 * Checksum of everything a shadow map depends on: every visible object's local transform (or its world matrix when
 * it is not auto-updated), caster flags, geometry identity, instance matrices, light settings. Skinned meshes force
 * a redraw. Index-weighted so moves that cancel out still change the key.
 */
function shadowKey(scene: Object3D) {
  let key = 0, i = 0;
  scene.traverseVisible((o) => {
    const w = ++i * 1.0000001;
    const p = o.position, q = o.quaternion, s = o.scale;
    key += w * (p.x + 3.1 * p.y + 7.3 * p.z + 11.7 * q.x + 13.1 * q.y + 17.9 * q.z + 19.3 * q.w + 23.1 * s.x + 29.3 * s.y + 31.7 * s.z);
    if (!o.matrixAutoUpdate || !o.matrixWorldAutoUpdate) { const e = o.matrixWorld.elements; key += w * (e[0] + 2.3 * e[5] + 4.1 * e[10] + 5.9 * e[12] + 7.7 * e[13] + 9.1 * e[14] + 1.7 * e[1] + 2.9 * e[8]); }
    const mesh = o as Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean; instanceMatrix?: { version: number }; count?: number };
    if (mesh.isMesh) {
      if (mesh.isSkinnedMesh) key = NaN;
      key += w * ((mesh.castShadow ? 37 : 41) + mesh.geometry.id * 0.013 + (mesh.isInstancedMesh ? mesh.instanceMatrix!.version * 0.37 + mesh.count! * 0.11 : 0) + (Array.isArray(mesh.material) ? 0 : ((mesh.material as { id?: number }).id ?? 0) * 0.007));
    }
    const light = o as SpotLight & { isLight?: boolean };
    if (light.isLight) key += w * ((light.castShadow ? 43 : 47) + (light.shadow?.mapSize.x ?? 0) * 0.001 + (light.shadow?.map ? 53 : 59));
  });
  return key;
}

/** Renderer, environment and shadow-flag setup while the factory lighting is active; restored on unmount. */
function LightingSetup() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  // Tone mapping, exposure, colour space and the HDR environment: SceneEnvironment (shared with the default scene).
  useEffect(() => {
    const previous = gl.shadowMap.type;
    gl.shadowMap.type = PCFShadowMap;
    return () => { gl.shadowMap.type = previous; };
  }, [gl]);

  // Shadow maps depend only on the shadow casters (the lights and the sun's shadow box are fixed, not camera-bound):
  // redraw them only when a transform / visibility / caster flag in the scene changed. Same maps, no idle passes.
  const shadowState = useMemo(() => ({ key: NaN }), []);
  useEffect(() => {
    if (isWebGPURenderer(gl)) return;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => { gl.shadowMap.autoUpdate = true; };
  }, [gl]);
  useFrame(() => {
    if (isWebGPURenderer(gl) || gl.shadowMap.autoUpdate) return;
    // Progressive template load: no per-frame shadow redraws while chunks drop in; one refresh when it ends.
    if (useTemplateLoadStore.getState().active) return;
    const key = shadowKey(scene);
    if (key !== shadowState.key || Number.isNaN(key)) { shadowState.key = key; gl.shadowMap.needsUpdate = true; }
  });

  // Every opaque mesh casts and receives shadows (transparent ghosts/highlights are left alone).
  const sweep = useMemo(() => ({ t: SHADOW_SWEEP_S }), []);
  useFrame((_, delta) => {
    sweep.t += delta;
    if (sweep.t < SHADOW_SWEEP_S) return;
    sweep.t = 0;
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as { transparent?: boolean; isShadowMaterial?: boolean } | undefined;
      if (!material || Array.isArray(material) || material.transparent || material.isShadowMaterial) return;
      // Floor-level flats (floor planes, decals, walkways) have nothing below them to shadow: skip their shadow passes.
      mesh.castShadow = !mesh.userData.shadowFloor && !mesh.userData.noCastShadow;
      mesh.receiveShadow = true;
    });
  });
  return null;
}

export default function FactoryLighting() {
  return (
    <>
      <LightingSetup />
      <Suspense fallback={null}>
        <GlbLights />
      </Suspense>
    </>
  );
}
