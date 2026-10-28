import { AgXToneMapping, EquirectangularReflectionMapping, SRGBColorSpace, type Texture } from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import hdrUrl from "@/assets/hdr/factory_hdr.exr?url";

/**
 * Single source of truth for the picture: HDR environment, tone mapping (AgX), exposure and output colour space,
 * for the default scene and the factory.glb lighting alike. WebGL tone-maps in the composer (PostProcessing
 * ToneMapping AGX, renderer stays NoToneMapping there); WebGPU has no composer and tone-maps in the renderer.
 * Default-scene lights (ambient 2 + key 2) are not physical units like the factory rig (LIGHT_SCALE), so the
 * environment is dimmed there to keep the same overall exposure instead of washing the scene out.
 */
export const SCENE_ENVIRONMENT = {
  toneMapping: AgXToneMapping,
  exposure: 1.0,
  outputColorSpace: SRGBColorSpace,
  /** scene.environmentIntensity per lighting preset. */
  environmentIntensity: { factory: 1.0, default: 0.4 },
} as const;

// Loaded once per session (the EXR decode is ~0.5 s of main thread); shared across remounts and presets.
let hdr: Promise<Texture> | null = null;
export function loadEnvironment() {
  hdr ??= new EXRLoader().loadAsync(hdrUrl).then((texture) => { texture.mapping = EquirectangularReflectionMapping; return texture; });
  return hdr;
}
