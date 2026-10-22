import { cn } from "@/lib/style";
import type { TimeShare, TimeShareKey } from "@/domain/stats/dashboardStats";
import { fmtPct } from "@/ui/Hud/dashboard/full/format";
import { SHARE_FILL, SHARE_LABELS } from "@/ui/Hud/dashboard/full/shareStyles";

const W = 600, H = 160, PAD = 4;


export function Empty({ className }: { className?: string }) {
  return <p className={cn("flex items-center justify-center text-[11px] text-text-secondary", className)}>데이터 수집 중…</p>;
}

/** Grouped bars (secondary + primary series) per bucket and a cumulative line of the primary series. */
export function BarLineChart({ labels, a, b, aLabel, bLabel }: { labels: string[]; a: number[]; b: number[]; aLabel: string; bLabel: string }) {
  if (a.length < 1) return <Empty className="h-40" />;
  const max = Math.max(1, ...a, ...b);
  const cumulative = b.reduce<number[]>((acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v], []);
  const cmax = Math.max(1, cumulative[cumulative.length - 1] ?? 1);
  const step = W / a.length, bar = Math.max(1, step / 2 - 1);
  const line = cumulative.map((v, i) => `${i * step + step / 2},${H - PAD - (v / cmax) * (H - 2 * PAD)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={`${aLabel} / ${bLabel} 구간별 막대와 누적 ${bLabel}`}>
        {a.map((v, i) => (
          <rect key={`a${i}`} x={i * step + 1} y={H - (v / max) * (H - PAD)} width={bar} height={(v / max) * (H - PAD)} className="fill-idle/50" />
        ))}
        {b.map((v, i) => (
          <rect key={`b${i}`} x={i * step + 1 + bar} y={H - (v / max) * (H - PAD)} width={bar} height={(v / max) * (H - PAD)} className="fill-brand-primary/70" />
        ))}
        <polyline points={line} fill="none" className="stroke-text-primary" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-text-secondary">
        <span>{labels[0]}</span>
        <span className="flex gap-3">
          <Legend className="bg-idle/50" label={aLabel} />
          <Legend className="bg-brand-primary/70" label={bLabel} />
          <Legend className="bg-text-primary h-px" label={`누적 ${bLabel}`} />
        </span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

export function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("inline-block h-2 w-2", className)} />
      {label}
    </span>
  );
}

/** One series line chart with a min/max readout. `values` may contain nulls (gaps). */
export function LineChart({ values, label, unit, max: fixedMax }: { values: (number | null)[]; label: string; unit: string; max?: number }) {
  const numbers = values.filter((v): v is number => v !== null);
  if (numbers.length < 2) return <Empty className="h-32" />;
  const max = fixedMax ?? Math.max(1, ...numbers);
  const step = W / Math.max(1, values.length - 1);
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null) { if (current.length) segments.push(current.join(" ")); current = []; return; }
    current.push(`${i * step},${H - PAD - (v / max) * (H - 2 * PAD)}`);
  });
  if (current.length) segments.push(current.join(" "));
  const last = numbers[numbers.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-32 w-full" role="img" aria-label={`${label} 추이`}>
        <line x1={0} x2={W} y1={H - PAD} y2={H - PAD} className="stroke-white/10" vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={PAD} y2={PAD} className="stroke-white/5" vectorEffect="non-scaling-stroke" />
        {segments.map((points, i) => (
          <polyline key={i} points={points} fill="none" className="stroke-brand-primary" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <p className="mt-1 flex justify-between text-[10px] tabular-nums text-text-secondary">
        <span>최근 {last.toFixed(1)}{unit}</span>
        <span>최대 {max.toFixed(1)}{unit}</span>
      </p>
    </div>
  );
}

/** Single stacked bar of time-share states with a legend. */
export function ShareBar({ share }: { share: TimeShare }) {
  const keys = Object.keys(SHARE_LABELS) as TimeShareKey[];
  const total = keys.reduce((s, k) => s + share[k], 0);
  if (total <= 0) return <Empty className="h-10" />;
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden bg-white/5" role="img" aria-label="시간 비율">
        {keys.map((k) => <div key={k} className={SHARE_FILL[k]} style={{ width: `${(share[k] / total) * 100}%` }} />)}
      </div>
      <dl className="mt-2 grid grid-cols-5 gap-2 text-[11px]">
        {keys.map((k) => (
          <div key={k}>
            <dt className="flex items-center gap-1 text-text-secondary"><span className={cn("inline-block h-2 w-2", SHARE_FILL[k])} />{SHARE_LABELS[k]}</dt>
            <dd className="tabular-nums text-text-primary">{fmtPct((share[k] / total) * 100)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Horizontal ranking bars. */
export function RankBars({ rows, unit }: { rows: { id: string; name: string; value: number | null }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  if (!rows.length) return <Empty className="h-12" />;
  return (
    <ol className="space-y-1">
      {rows.map((row, i) => (
        <li key={row.id} className="grid grid-cols-[1.25rem_7rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-[11px]">
          <span className="tabular-nums text-text-secondary">{i + 1}</span>
          <span className="truncate text-text-primary" title={row.name}>{row.name}</span>
          <span className="h-[3px] bg-white/10"><span className="block h-full bg-brand-primary" style={{ width: `${((row.value ?? 0) / max) * 100}%` }} /></span>
          <span className="text-right tabular-nums text-text-primary">{row.value == null ? "—" : `${row.value.toFixed(1)}${unit}`}</span>
        </li>
      ))}
    </ol>
  );
}