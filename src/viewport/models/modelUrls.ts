import { useGLTF } from "@/lib/three/gltfLoader";
import { amrUrl, forkliftUrl, boxUrl, palletUrl, rackUrl, robotArmUrl as robotUrl, railUrl, railCUrl, scanTunnelUrl as scannerUrl } from "@/constants/modelAssets";

export const MODEL = { robot: robotUrl, pallet: palletUrl, box: boxUrl, amr: amrUrl, scanner: scannerUrl, rack: rackUrl, rail: railUrl, railC: railCUrl, forklift: forkliftUrl };
export const MODEL_URLS = Object.values(MODEL);
// Parse and decode every GLB at app load, long before it is first needed.
for (const url of MODEL_URLS) useGLTF.preload(url);

/** File name for logs, e.g. "robot.glb" (hash suffix kept if the bundler added one). */
export const modelFileName = (url: string) => decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? url);
