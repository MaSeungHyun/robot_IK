export function formatMetric(value: number | undefined, unit = "", digits = 1): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;

  const formatted = value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Continuous (smoothed) readouts: always exactly one decimal place so the text width never jitters. */
export function formatFixed(value: number | undefined, unit = ""): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;

  const formatted = value.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Count-like rates and totals (items/h, boxes): always a whole number, rounded for display. */
export function formatInteger(value: number | undefined, unit = ""): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;

  const formatted = Math.round(value).toLocaleString("ko-KR");
  return unit ? `${formatted} ${unit}` : formatted;
}
