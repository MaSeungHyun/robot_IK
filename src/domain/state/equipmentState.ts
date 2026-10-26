/**
 * Typed equipment state model: every robot / vehicle reports one common operation state, narrowed per equipment
 * category (discriminated union on `category`). Pure domain: derived from the simulator's own phases and statuses.
 */
export type OperationState =
  | "idle" | "moving" | "loading" | "unloading" | "transferring" | "charging" | "waiting" | "blocked" | "error" | "disabled";
export type EquipmentCategory = "robotArm" | "amr" | "forklift" | "cycle";

/** Robot arm: stationary, never moves or charges. */
export type RobotArmState = { category: "robotArm"; state: Exclude<OperationState, "moving" | "charging"> };
/** Pallet AMR: drives, carries pallets on its deck, charges at its home. */
export type AmrState = { category: "amr"; state: OperationState };
/** Rack forklift: drives and lifts, no charging modelled. */
export type ForkliftState = { category: "forklift"; state: Exclude<OperationState, "charging"> };
/** Pallet cycle actor (shuttle, forklift, AGV, Rack_m). */
export type CycleActorState = { category: "cycle"; state: Exclude<OperationState, "charging"> };
export type EquipmentState = RobotArmState | AmrState | ForkliftState | CycleActorState;

export const OPERATION_LABEL: Record<OperationState, string> = {
  idle: "유휴",
  moving: "이동 중",
  loading: "적재 중",
  unloading: "하역 중",
  transferring: "운반 중",
  charging: "충전 중",
  waiting: "대기",
  blocked: "막힘",
  error: "오류",
  disabled: "비활성",
};
export const CATEGORY_LABEL: Record<EquipmentCategory, string> = { robotArm: "로봇 팔", amr: "AMR", forklift: "지게차", cycle: "팔레트 순환 장비" };

const ERROR_WORDS = ["실패", "오류", "불가"];
const has = (text: string, words: string[]) => words.some((w) => text.includes(w));

/** Robot arm row (simulator state working/idle/disabled + status text) -> typed state. */
export function robotArmState(state: "working" | "idle" | "disabled", status: string): RobotArmState {
  if (state === "disabled") return { category: "robotArm", state: "disabled" };
  if (has(status, ERROR_WORDS)) return { category: "robotArm", state: "error" };
  if (state === "idle") return { category: "robotArm", state: has(status, ["대기"]) ? "waiting" : "idle" };
  if (has(status, ["하역"])) return { category: "robotArm", state: "unloading" };
  if (has(status, ["적재", "팔레트"])) return { category: "robotArm", state: "loading" };
  return { category: "robotArm", state: "transferring" };
}

export type AgentPhase =
  | "idle" | "pickup" | "loading" | "dispatch" | "unloading" | "storing" | "returning" | "receiving" | "blocked" | "waiting" | "yielding" | "charging" | "disabled";
const PHASE_OPERATION: Record<AgentPhase, OperationState> = {
  idle: "idle",
  pickup: "moving",
  loading: "loading",
  dispatch: "transferring",
  unloading: "unloading",
  storing: "unloading",
  returning: "moving",
  receiving: "loading",
  blocked: "blocked",
  waiting: "waiting",
  yielding: "waiting",
  charging: "charging",
  disabled: "disabled",
};
/** Vehicle row phase -> typed state for its category (charging only exists for AMRs). */
export function vehicleState(category: Exclude<EquipmentCategory, "robotArm">, phase: AgentPhase, status: string): EquipmentState {
  let state = PHASE_OPERATION[phase];
  if (state !== "disabled" && has(status, ERROR_WORDS)) state = "error";
  if (category === "amr") return { category, state };
  return { category, state: state === "charging" ? "waiting" : state };
}