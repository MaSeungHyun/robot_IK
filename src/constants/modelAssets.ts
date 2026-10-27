/**
 * Single source of every GLB URL. No component imports "@/assets/models/*.glb" directly.
 *
 * VITE_USE_OPTIMIZED_MODELS (.env, default true):
 *   true  -> src/assets/models          (optimized: dedup/prune/weld, WebP textures, RobotArm 1024 without specular/anisotropy/IOR)
 *   false -> src/assets/models_original (authored originals, byte-identical backup)
 * Switching needs a dev-server restart / rebuild (the folder alias is resolved in vite.config.ts). Node scripts always read models_original.
 */
const USE_OPTIMIZED_MODELS = import.meta.env.VITE_USE_OPTIMIZED_MODELS !== "false";
export { USE_OPTIMIZED_MODELS };

// "@models" is aliased in vite.config.ts to the folder the flag selects, so only that set is emitted.
const files = import.meta.glob<string>("@models/*.glb", { query: "?url", import: "default", eager: true });

/** File names are matched case-insensitively (e.g. "Rack.glb" -> rack.glb). */
function modelUrl(fileName: string): string {
  const key = Object.keys(files).find((path) => path.split("/").pop()!.toLowerCase() === fileName.toLowerCase());
  if (!key) throw new Error(`모델 파일을 찾을 수 없습니다: ${fileName}`);
  return files[key];
}

export const amrUrl = modelUrl("AMR.glb");
export const boxUrl = modelUrl("box.glb");
export const forkliftUrl = modelUrl("Forklift.glb");
export const palletUrl = modelUrl("pallet.glb");
export const rackUrl = modelUrl("Rack.glb");
export const railUrl = modelUrl("rail.glb");
/** rail_c.glb: S lane shift built from two 90° corners; turn segments reuse its first corner. */
export const railCUrl = modelUrl("rail_c.glb");
export const robotArmUrl = modelUrl("RobotArm.glb");
export const scanTunnelUrl = modelUrl("ScanTunnel.glb");