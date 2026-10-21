import type { RobotTimeShare } from "@/stores/useDerivedMetricsStore";
import { formatFixed } from "@/utils/equipment/formatMetric";

const SEGMENTS = [
  { key: "processing", label: "가공", color: "var(--color-brand-primary)" },
  { key: "transfer", label: "이송", color: "var(--color-info)" },
  { key: "wait", label: "대기", color: "var(--color-idle)" },
] as const;
const RADIUS = 15, CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Donut of robot time: processing (at box/pallet), transfer (carrying), wait (idle). */
export default function LineTimeShareDonut({ share }: { share: RobotTimeShare }) {
  const total = share.processing + share.transfer + share.wait;
  let offset = 0;
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 40 40" className="size-12 -rotate-90" role="img" aria-label="공정 시간 비율">
        <circle cx={20} cy={20} r={RADIUS} fill="none" stroke="rgb(255 255 255 / .08)" strokeWidth={6} />
        {total > 0 && SEGMENTS.map(({ key, color }) => {
          const length = (share[key] / total) * CIRCUMFERENCE;
          const arc = <circle key={key} cx={20} cy={20} r={RADIUS} fill="none" stroke={color} strokeWidth={6} strokeDasharray={`${length} ${CIRCUMFERENCE - length}`} strokeDashoffset={-offset} />;
          offset += length;
          return arc;
        })}
      </svg>
      <ul className="text-[10px] leading-4">
        {SEGMENTS.map(({ key, label, color }) => (
          <li key={key} className="flex items-center gap-1">
            <span className="size-1.5 rounded-full" style={{ background: color }} />
            <span className="text-text-secondary">{label}</span>
            <span className="ml-auto w-10 text-right tabular-nums">{total > 0 ? formatFixed((share[key] / total) * 100, "%") : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
