import type { BadgeTone } from "@/components/Badge";
import { AMR_BATTERY } from "@/constants/simulatorLayout";
import type { ScannerSnapshot } from "@/types/scanner";
import type { EquipmentSnapshot } from "@/types/simulation";

export type StatusLabel = { label: string; tone: BadgeTone };

/**
 * Equipment status shown in the 장비 현황 panel: only these five. Detailed sub-states stay in
 * tooltips. Priority when several apply: 고장 > 충전 > 경고 > 가동 > 대기.
 */
export type EquipmentState = "fault" | "charging" | "warning" | "operating" | "idle";

export const EQUIPMENT_STATES: Record<EquipmentState, StatusLabel> = {
  operating: { label: "가동", tone: "operating" },
  idle: { label: "대기", tone: "idle" },
  warning: { label: "경고", tone: "warning" },
  fault: { label: "고장", tone: "fault" },
  charging: { label: "충전", tone: "charging" },
};

/** Low battery (경고): below the level at which an idle AMR goes to charge. */
export const LOW_BATTERY_PERCENT = AMR_BATTERY.chargeBelow;

type RobotState = EquipmentSnapshot["robots"][number]["state"];
type Agent = EquipmentSnapshot["agents"][number];
type AgentState = Agent["state"];

export const ROBOT_STATES = {
  working: "operating",
  idle: "idle",
  disabled: "idle",
} satisfies Record<RobotState, EquipmentState>;

export const AGENT_STATES = {
  idle: "idle",
  waiting: "idle",
  disabled: "idle",
  pickup: "operating",
  loading: "operating",
  dispatch: "operating",
  unloading: "operating",
  storing: "operating",
  returning: "operating",
  receiving: "operating",
  yielding: "operating",
  charging: "charging",
  blocked: "fault",
} satisfies Record<AgentState, EquipmentState>;

export function robotState(state: RobotState): EquipmentState {
  return ROBOT_STATES[state];
}

export function agentState(agent: Pick<Agent, "state" | "battery">): EquipmentState {
  const base: EquipmentState = AGENT_STATES[agent.state];
  if (base === "fault" || base === "charging") return base;
  if (agent.state !== "disabled" && Number.isFinite(agent.battery) && agent.battery < LOW_BATTERY_PERCENT) return "warning";
  return base;
}

export function palletStatus({
  shipping,
  count,
  capacity,
}: Pick<
  EquipmentSnapshot["pallets"][number],
  "shipping" | "count" | "capacity"
>): StatusLabel {
  if (shipping) return { label: "운반 중", tone: "operating" };
  if (count >= capacity) return { label: "적재 완료", tone: "safe" };
  if (count > 0) return { label: "적재 중", tone: "operating" };
  return { label: "대기", tone: "idle" };
}

/** Conveyor: 가동 while the simulation runs it, otherwise 대기 (stopped/disabled included). */
export function conveyorState(enabled: boolean | undefined, running: boolean): EquipmentState {
  return enabled !== false && running ? "operating" : "idle";
}

/** Scanner: inspecting (pass or defect reject) is 가동; disabled or nothing scanned yet is 대기. */
export function scannerState(enabled: boolean | undefined, scanner: ScannerSnapshot | undefined): EquipmentState {
  return enabled !== false && scanner?.lastResult ? "operating" : "idle";
}

/** Summary badges, in display order. */
export const STATUS_SUMMARY: (StatusLabel & { state: EquipmentState })[] = (
  ["operating", "idle", "warning", "fault", "charging"] as const
).map((state) => ({ state, ...EQUIPMENT_STATES[state] }));

export const KIND_FILTERS = [
  { value: "all", label: "전체" },
  { value: "robot", label: "로봇" },
  { value: "amr", label: "AMR" },
  { value: "conveyor", label: "컨베이어" },
  { value: "scanner", label: "스캐너" },
] as const;

export type KindFilter = (typeof KIND_FILTERS)[number]["value"];

/** Battery tone: safe, then warning below 30%, fault below 15%. */
export function batteryTone(percent: number): BadgeTone {
  return percent < 20 ? "fault" : percent < 30 ? "warning" : "safe";
}
/** Robot utilization bar tone: red below 20%, yellow below 30%, otherwise operating. */
export function utilizationTone(percent: number): BadgeTone {
  return percent < 20 ? "fault" : percent < 30 ? "warning" : "operating";
}
