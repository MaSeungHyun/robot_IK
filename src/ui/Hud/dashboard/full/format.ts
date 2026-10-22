/** Dashboard number formatting (Korean units); null/undefined renders as an em dash. */
export const dash = "—";
export const fmtInt = (v: number | null | undefined, unit = "") => (v == null || !Number.isFinite(v) ? dash : `${Math.round(v).toLocaleString("ko-KR")}${unit}`);
export const fmtPct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? dash : `${v.toFixed(digits)}%`);
export const fmtChange = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? dash : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
/** Simulation seconds as h:mm:ss (or m:ss under an hour). */
export function fmtTime(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return dash;
  const s = Math.max(0, Math.floor(seconds)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
export const fmtDuration = (seconds: number | null | undefined) =>
  seconds == null || !Number.isFinite(seconds) ? dash : seconds < 60 ? `${seconds.toFixed(0)}초` : `${(seconds / 60).toFixed(1)}분`;