import { formatFixed } from "@/utils/equipment/formatMetric";

/** Fixed-decimal formatter with a unit, for SmoothValue. */
export const fixed = (unit: string) => (value: number) => formatFixed(value, unit);
