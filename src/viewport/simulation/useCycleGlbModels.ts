import { useGLTF } from "@/lib/three/gltfLoader";
import { agvModelUrl, rackMobileUrl } from "@/constants/cycleModelAssets";
import { setCycleGlbModels } from "@/lib/three/cycleModels";

// The URLs are build-time constants, so each hook below is either always or never called.
const useAgv = agvModelUrl ? ((url) => () => useGLTF(url).scene)(agvModelUrl) : () => undefined;
const useRackM = rackMobileUrl ? ((url) => () => useGLTF(url).scene)(rackMobileUrl) : () => undefined;

/** Loads AGV.glb / Rack_m.glb (suspends) and registers them so createAgvModel / createRackMobileModel use them. */
export function useCycleGlbModels() {
  const agv = useAgv();
  const rackM = useRackM();
  setCycleGlbModels({ agv, rackM });
}

if (agvModelUrl) useGLTF.preload(agvModelUrl);
if (rackMobileUrl) useGLTF.preload(rackMobileUrl);
