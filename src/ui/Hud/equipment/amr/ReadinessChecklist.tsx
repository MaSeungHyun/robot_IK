import { cn } from "@/lib/style";
import type { ReadinessCheck } from "@/domain/cycle/shuttleReadiness";

/** 행동 준비 체크리스트: 필수 항목이 모두 충족되면 "작동 가능". */
export default function ReadinessChecklist({ checks }: { checks: readonly ReadinessCheck[] }) {
  const ready = checks.filter((c) => c.required).every((c) => c.ok);

  return (
    <div className="mt-2 rounded-[3px] border border-white/10 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold text-text-primary">행동 준비</span>
        <span className={ready ? "text-emerald-400" : "text-amber-400"}>{ready ? "작동 가능" : "필수 항목 필요"}</span>
      </div>
      <ul className="space-y-1">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-1.5 text-[11px]">
            <span aria-hidden className={cn("mt-0.5 w-3 shrink-0 text-center", c.ok ? "text-emerald-400" : "text-text-secondary")}>
              {c.ok ? "✓" : "○"}
            </span>
            <span className="min-w-0">
              <span className="text-text-primary">{c.label}</span>
              <span className="text-text-secondary"> · {c.required ? "필수" : "권장"}{c.ok ? "" : ` · ${c.hint}`}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
