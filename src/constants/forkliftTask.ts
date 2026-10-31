import type { EquipmentSettings } from "@/types/layout";

/**
 * Cycle forklift jobs (forkliftTask). No forklift ships pallets out through a door any more.
 * - mobileRack (이동식 랙 적재): full pallet off a shuttle AMR → Rack_m level (or the fixed rack when no Rack_m is enabled).
 * - rack (랙 적재): Rack_m at the drop point → fixed rack.
 * - palletSwap (팔레트 교체): empty pallet source → shuttle AMR, and emptied pallets off AMRs → source.
 * - unload (하역): holds a pallet at a palletizing robot, stores it full in a fixed rack and brings an empty pallet back.
 * Legacy values (service / carrier) are migrated at load time by normalizeForkliftTask.
 */
export const FORKLIFT_TASKS = ["mobileRack", "rack", "palletSwap", "unload"] as const;
export type ForkliftTask = (typeof FORKLIFT_TASKS)[number];
export const FORKLIFT_TASK_LABELS: Record<ForkliftTask, string> = {
  mobileRack: "이동식 랙 적재 (만재 팔레트 AMR → Rack_m)",
  rack: "랙 적재 (Rack_m → 랙)",
  palletSwap: "팔레트 교체 (빈 팔레트 적치장 ↔ AMR)",
  unload: "하역 (로봇 적재 → 랙 적재 → 빈 팔레트 복귀)",
};
export const FORKLIFT_TASK_SHORT: Record<ForkliftTask, string> = { mobileRack: "이동식 랙 적재 지게차", rack: "랙 적재 지게차", palletSwap: "팔레트 교체 지게차", unload: "하역 지게차" };
/** Old service / carrier values → the explicit tasks (service + 빈 팔레트 전담 → palletSwap). */
export function normalizeForkliftTask(config?: Pick<EquipmentSettings, "forkliftTask" | "forkliftRole">): ForkliftTask | undefined {
  const task = config?.forkliftTask;
  if (task === "service") return config?.forkliftRole === "supply" || config?.forkliftRole === "emptyReturn" ? "palletSwap" : "mobileRack";
  if (task === "carrier") return "unload";
  return task;
}
/** Jobs at the shuttle service stop (the old "service" forklift split in two). */
export const isServiceTask = (task?: string) => task === "mobileRack" || task === "palletSwap";
