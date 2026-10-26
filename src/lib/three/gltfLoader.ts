import { useGLTF as useDreiGLTF } from "@react-three/drei";
import { DoubleSide, Mesh, WebGLRenderer, type Material, type Object3D } from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

/**
 * Every app GLB load goes through here so KTX2 (KHR_texture_basisu) textures decode.
 * The optimized models (src/assets/models) use KTX2; the originals have none, and the extra loader is harmless for them.
 * The Basis transcoder is served locally from public/basis/ (copied from three/examples/jsm/libs/basis).
 */
let ktx2: KTX2Loader | null = null;
let supportDetected = false;

/** Shared KTX2Loader. Preloads run before the Canvas exists, so support is first detected on a throwaway renderer. */
export function getKTX2Loader(): KTX2Loader {
  if (!ktx2) ktx2 = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`);
  if (!supportDetected) {
    const probe = new WebGLRenderer();
    ktx2.detectSupport(probe);
    probe.dispose();
    probe.forceContextLoss();
    supportDetected = true;
  }
  return ktx2;
}

/** Re-detect GPU texture formats with the real renderer (call from Canvas onCreated); WebGL or WebGPURenderer. */
export function configureKTX2(gl: Parameters<KTX2Loader["detectSupport"]>[0]) {
  if (!ktx2) ktx2 = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`);
  ktx2.detectSupport(gl);
  supportDetected = true;
}

type ExtendLoader = NonNullable<Parameters<typeof useDreiGLTF>[3]>;
/** drei's GLTFLoader (three-stdlib) supports KHR_texture_basisu through setKTX2Loader. */
export const extendGLTFLoader: ExtendLoader = (loader) => { loader.setKTX2Loader(getKTX2Loader() as unknown as Parameters<typeof loader.setKTX2Loader>[0]); };

/**
 * Transparent DoubleSide materials (e.g. the models' "shadow" decal planes) make three.js draw back then front faces in two
 * passes, setting material.needsUpdate twice per draw, which re-runs getProgram every frame. One pass draws both faces;
 * for these flat, single-layer decals the result is the same.
 */
const prepared = new WeakSet<Object3D>();
function prepareMaterials(scene: Object3D) {
  if (prepared.has(scene)) return;
  prepared.add(scene);
  scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    for (const material of (Array.isArray(node.material) ? node.material : [node.material]) as Material[])
      if (material.transparent && material.side === DoubleSide) material.forceSinglePass = true;
  });
}

/** drei useGLTF with KTX2 wired (Draco / Meshopt defaults unchanged). */
export function useGLTF(url: string) {
  const gltf = useDreiGLTF(url, true, true, extendGLTFLoader);
  for (const item of Array.isArray(gltf) ? gltf : [gltf]) prepareMaterials(item.scene);
  return gltf;
}
useGLTF.preload = (url: string) => useDreiGLTF.preload(url, true, true, extendGLTFLoader);