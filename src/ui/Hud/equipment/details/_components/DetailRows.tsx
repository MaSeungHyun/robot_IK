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
    <dl>
      {rows.map(({ label, value, progress }) => {
        const percentage = progress !== undefined && Number.isFinite(progress)
          ? Math.max(0, Math.min(100, progress)) : undefined;

        return (
          <div key={label} className="grid min-h-5 grid-cols-[40%_minmax(0,1fr)] items-center gap-2 py-px">
            <dt className="truncate text-[11px] leading-4 text-text-secondary" title={label}>{label}</dt>
            <dd className="flex min-w-0 items-center gap-2 text-[11px] leading-4">
              {percentage !== undefined && (
                <div role="progressbar" aria-label={label} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100} className="h-[3px] min-w-10 flex-1 overflow-hidden bg-white/10">
                  <div className="h-full bg-brand-primary transition-[width]" style={{ width: `${percentage}%` }} />
                </div>
              )}
              <span title={value == null ? "데이터 미연결" : undefined} className={cn("min-w-0 break-words tabular-nums [overflow-wrap:anywhere]", percentage !== undefined && "shrink-0 text-right", value == null ? "text-offline" : "text-text-primary")}>
                {value ?? "—"}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
