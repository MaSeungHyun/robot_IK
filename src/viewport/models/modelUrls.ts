import { useGLTF } from "@react-three/drei";
import amrUrl from "@/assets/models/AMR.glb?url";
import boxUrl from "@/assets/models/box.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";
import rackUrl from "@/assets/models/Rack.glb?url";
import robotUrl from "@/assets/models/RobotArm.glb?url";
import railUrl from "@/assets/models/rail.glb?url";
import scannerUrl from "@/assets/models/ScanTunnel.glb?url";

export const MODEL = { robot: robotUrl, pallet: palletUrl, box: boxUrl, amr: amrUrl, scanner: scannerUrl, rack: rackUrl, rail: railUrl };
export const MODEL_URLS = Object.values(MODEL);
// Parse and decode every GLB at app load, long before it is first needed.
for (const url of MODEL_URLS) useGLTF.preload(url);

/** File name for logs, e.g. "robot.glb" (hash suffix kept if the bundler added one). */
export const modelFileName = (url: string) => decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? url);
