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
