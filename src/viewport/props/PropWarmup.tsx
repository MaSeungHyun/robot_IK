import { useEffect } from "react";
import type { Object3D } from "three";
import { useGLTF } from "@/lib/three/gltfLoader";
import { PROP_SOURCES } from "@/viewport/props/propSources";
import { markPropsWarmed, propScenes } from "@/viewport/props/propWarmupState";

const URLS = [...new Set(Object.values(PROP_SOURCES).filter((url): url is string => !!url))];

/** One prop GLB: suspends until downloaded (once, via glbCache) and parsed, then hands its scene to the warm-up. */
function PropSourceWarmup({ url }: { url: string }) {
  const { scene } = useGLTF(url) as unknown as { scene: Object3D };
  useEffect(() => {
    propScenes.set(url, scene);
    if (URLS.every((u) => propScenes.has(u))) markPropsWarmed();
  }, [scene, url]);
  return null;
}

/**
 * Startup preload of every template prop GLB, so loading the factory template later only clones, merges and reveals
 * (ModelWarmup compiles them with the factory light rig). Mount inside Suspense; renders nothing.
 */
export default function PropWarmup() {
  if (URLS.length === 0) markPropsWarmed();
  return URLS.map((url) => <PropSourceWarmup key={url} url={url} />);
}