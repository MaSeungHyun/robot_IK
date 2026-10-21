import type { BadgeTone } from "@/components/Badge";
import type { ScannerSnapshot } from "@/types/scanner";
import type { EquipmentSnapshot } from "@/types/simulation";

export type StatusLabel = { label: string; tone: BadgeTone };

export const ROBOT_STATUSES = {
  working: { label: "작업 중", tone: "operating" },
  idle: { label: "대기", tone: "idle" },
  disabled: { label: "중지", tone: "offline" },
} satisfies Record<EquipmentSnapshot["robots"][number]["state"], StatusLabel>;

export const AGENT_TONES = {
  idle: "idle",
  pickup: "operating",
  loading: "operating",
  dispatch: "operating",
  unloading: "operating",
  storing: "operating",
  returning: "info",
  blocked: "warning",
  waiting: "idle",
  yielding: "warning",
  charging: "operating",
  disabled: "offline",
} satisfies Record<EquipmentSnapshot["agents"][number]["state"], BadgeTone>;

export function palletStatus({
  shipping,
  count,
  capacity,
}: Pick<
  EquipmentSnapshot["pallets"][number],
  "shipping" | "count" | "capacity"
>): StatusLabel {
  if (shipping) return { label: "운반 중", tone: "operating" };
  if (count >= capacity) return { label: "적재 완료", tone: "info" };
  if (count > 0) return { label: "적재 중", tone: "operating" };
  return { label: "대기", tone: "idle" };
}

export function conveyorStatus(
  enabled: boolean | undefined,
  running: boolean,
): StatusLabel {
  if (enabled === false) return { label: "중지", tone: "offline" };
  return running
    ? { label: "이송 중", tone: "operating" }
    : { label: "일시 정지", tone: "idle" };
}

export function scannerStatus(
  enabled: boolean | undefined,
  scanner: ScannerSnapshot | undefined,
): StatusLabel {
  if (enabled === false) return { label: "중지", tone: "offline" };
  if (scanner?.lastResult === "fault") return { label: "불량", tone: "fault" };
  if (scanner?.lastResult === "safe") return { label: "통과", tone: "safe" };
  return { label: "검사 대기", tone: "idle" };
}

/** Summary badge labels, in display order. */
export const STATUS_SUMMARY: { tone: BadgeTone; label: string }[] = [
  { tone: "operating", label: "가동" },
  { tone: "safe", label: "정상" },
  { tone: "info", label: "완료·충전" },
  { tone: "warning", label: "경고" },
  { tone: "fault", label: "이상" },
  { tone: "idle", label: "대기" },
  { tone: "offline", label: "중지" },
];

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
  return percent < 15 ? "fault" : percent < 30 ? "warning" : "safe";
}
