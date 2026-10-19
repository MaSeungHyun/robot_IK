export function formatMetric(value: number | undefined, unit = "", digits = 1): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;

  const formatted = value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
  return unit ? `${formatted} ${unit}` : formatted;
}
