import { Suspense, useEffect, useLayoutEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AgXToneMapping,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Object3D,
  PCFShadowMap,
  SpotLight,
  Vector3,
  type Mesh,
  type Texture,
} from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { useGLTF } from "@/lib/three/gltfLoader";
import { selectShadowQuality, useViewportSettingsStore } from "@/stores/useViewportSettingsStore";
import { isWebGPURenderer } from "@/viewport/renderer/createRenderer";
import factoryGlbUrl from "@/constants/templates/factory.glb?url";
import hdrUrl from "@/assets/hdr/factory_hdr.exr?url";

/**
 * Blender look for the "factory" lighting templates: the factory.glb KHR_lights_punctual lights (authored transforms,
 * cone angles/penumbra/decay) with Blender-matched intensities, the factory HDR as environment, AgX tone mapping.
 * The glb stores W converted to candela (e.g. 119573 cd); three's physically based units need these values instead.
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
/** How often new meshes (spawned boxes, AMRs, ...) are switched to cast/receive shadows. */
const SHADOW_SWEEP_S = 1;

function GlbLights() {
  const quality = useViewportSettingsStore(selectShadowQuality);
  const { scene } = useGLTF(factoryGlbUrl) as unknown as { scene: Object3D };
  const lights = useMemo(() => {
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
  }, [scene]);

  // Low-quality fallback: "low" keeps only the sun shadow (2048), "off" drops every shadow map.
  useLayoutEffect(() => {
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
  }, [lights, quality]);

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

  useEffect(() => {
    // WebGL draws through the EffectComposer, which forces NoToneMapping; AgX is applied there (PostProcessing).
    const direct = isWebGPURenderer(gl);
    const previous = { toneMapping: gl.toneMapping, exposure: gl.toneMappingExposure, type: gl.shadowMap.type };
    if (direct) gl.toneMapping = AgXToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.shadowMap.type = PCFShadowMap;
    return () => {
      if (direct) gl.toneMapping = previous.toneMapping;
      gl.toneMappingExposure = previous.exposure;
      gl.shadowMap.type = previous.type;
    };
  }, [gl]);

  useEffect(() => {
    let disposed = false;
    let texture: Texture | null = null;
    const background = scene.background, intensity = scene.environmentIntensity;
    scene.background = new Color(0x000000);
    new EXRLoader().load(hdrUrl, (loaded) => {
      if (disposed) { loaded.dispose(); return; }
      loaded.mapping = EquirectangularReflectionMapping;
      texture = loaded;
      scene.environment = loaded;
      scene.environmentIntensity = 1.0;
    });
    return () => {
      disposed = true;
      if (texture && scene.environment === texture) scene.environment = null;
      texture?.dispose();
      scene.background = background;
      scene.environmentIntensity = intensity;
    };
  }, [scene]);

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
