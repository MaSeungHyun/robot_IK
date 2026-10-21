import type { CountSample } from "@/stores/useDerivedMetricsStore";
import { formatInteger } from "@/utils/equipment/formatMetric";

const WIDTH = 180, HEIGHT = 48;

/** Lightweight SVG line chart of the line's production rate (items/h) per history step, in simulation time. */
export default function LineRateChart({ history, robotIds }: { history: CountSample[]; robotIds: string[] }) {
  const rates = history.slice(1).map((sample, index) => {
    const previous = history[index];
    const dt = sample.t - previous.t;
    const made = robotIds.reduce((sum, id) => sum + ((sample.counts[id] ?? 0) - (previous.counts[id] ?? 0)), 0);
    return dt > 0 ? (made / dt) * 3600 : 0;
  });
  if (rates.length < 2) return <p className="flex h-12 items-center text-[10px] text-text-secondary">데이터 수집 중…</p>;

  const max = Math.max(...rates, 1);
  const points = rates.map((rate, index) => `${(index / (rates.length - 1)) * WIDTH},${HEIGHT - (rate / max) * (HEIGHT - 4) - 2}`);
  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-12 w-full text-brand-primary" preserveAspectRatio="none" role="img" aria-label="생산 속도 추이">
        <polygon points={`0,${HEIGHT} ${points.join(" ")} ${WIDTH},${HEIGHT}`} fill="currentColor" opacity={0.12} />
        <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="text-right text-[10px] tabular-nums text-text-secondary">최근 {formatInteger(rates[rates.length - 1], "개/h")} · 최대 {formatInteger(max, "개/h")}</p>
    </div>
  );
}
