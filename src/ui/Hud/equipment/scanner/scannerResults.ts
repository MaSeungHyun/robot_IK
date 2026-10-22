import type { ScannerSnapshot } from "@/types/scanner";

/** Inspection results of one scanner: total boxes passed, OK, NG and defect rate (NG / total, %). */
export function scannerResults(snapshot: ScannerSnapshot | undefined) {
  const total = snapshot?.scanned ?? 0, ng = snapshot?.faults ?? 0;
  return { total, ok: total - ng, ng, defectRate: total > 0 ? (ng / total) * 100 : undefined };
}

/** Defect rate with one decimal, "—" before the first box. */
export const formatDefectRate = (rate: number | undefined) =>
  rate === undefined ? "—" : `${rate.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
