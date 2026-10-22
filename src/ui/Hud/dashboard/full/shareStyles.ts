import type { TimeShareKey } from "@/domain/stats/dashboardStats";

export const SHARE_LABELS: Record<TimeShareKey, string> = { run: "작업", move: "이동", wait: "대기", charge: "충전", fault: "이상" };
/** Fill classes per time-share state (theme tokens only). */
export const SHARE_FILL: Record<TimeShareKey, string> = {
  run: "bg-brand-primary", move: "bg-brand-primary/50", wait: "bg-idle/60", charge: "bg-warning/70", fault: "bg-fault/80",
};