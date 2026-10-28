import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Color } from "three";
import { isWebGPURenderer } from "@/viewport/renderer/createRenderer";
import { SCENE_ENVIRONMENT, loadEnvironment } from "@/viewport/lighting/sceneEnvironmentConfig";

/** Applies SCENE_ENVIRONMENT (see sceneEnvironmentConfig.ts) to the renderer and scene for the active lighting preset. */
export default function SceneEnvironment({ preset }: { preset: "factory" | "default" }) {
  const get = useThree((state) => state.get);
  useEffect(() => {
    const { gl } = get();
    if (isWebGPURenderer(gl)) gl.toneMapping = SCENE_ENVIRONMENT.toneMapping;
    gl.toneMappingExposure = SCENE_ENVIRONMENT.exposure;
    gl.outputColorSpace = SCENE_ENVIRONMENT.outputColorSpace;
  }, [get]);
  useEffect(() => {
    const { scene } = get();
    let disposed = false;
    const background = scene.background;
    if (preset === "factory") scene.background = new Color(0x000000);
    void loadEnvironment().then((texture) => {
      if (disposed) return;
      scene.environment = texture;
      scene.environmentIntensity = SCENE_ENVIRONMENT.environmentIntensity[preset];
    }).catch((error: unknown) => console.warn("[SceneEnvironment] HDR load failed", error));
    return () => { disposed = true; scene.background = background; };
  }, [get, preset]);
  return null;
}