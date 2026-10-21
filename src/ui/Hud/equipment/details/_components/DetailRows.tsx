import type { ReactNode } from "react";
import { cn } from "@/lib/style";

type DetailRow = {
  label: string;
  value?: ReactNode;
  progress?: number;
};

type Props = { rows: DetailRow[] };

export default function DetailRows({ rows }: Props) {
  return (
    <dl className="divide-y divide-brand-primary/10">
      {rows.map(({ label, value, progress }) => {
        const percentage = progress !== undefined && Number.isFinite(progress)
          ? Math.max(0, Math.min(100, progress)) : undefined;

        return (
          <div key={label} className="grid min-h-5 grid-cols-[42%_minmax(0,1fr)] items-center gap-2 py-0.5">
            <dt className="text-[11px] leading-4 text-text-secondary">{label}</dt>
            <dd className="flex min-w-0 items-center gap-2 text-[11px] leading-4">
              <span title={value == null ? "데이터 미연결" : undefined} className={cn("min-w-0 break-words [overflow-wrap:anywhere]", value == null ? "text-offline" : "text-text-primary")}>
                {value ?? "—"}
              </span>

              {percentage !== undefined && (
                <div role="progressbar" aria-label={label} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100} className="h-2 min-w-10 flex-1 overflow-hidden rounded-sm bg-idle/20">
                  <div className="h-full rounded-sm bg-operating transition-[width]" style={{ width: `${percentage}%` }} />
                </div>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
