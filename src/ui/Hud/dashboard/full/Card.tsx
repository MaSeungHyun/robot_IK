import type { ReactNode } from "react";
import { cn } from "@/lib/style";

/** Flat dashboard section: thin border, small title, no shadow. */
export default function Card({ title, children, className, aside }: { title: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section aria-label={title} className={cn("min-w-0 rounded-[3px] border border-white/10 p-3", className)}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-text-primary">{title}</h3>
        {aside && <div className="text-[10px] text-text-secondary">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[3px] border border-white/10 px-3 py-2">
      <p className="truncate text-[11px] text-text-secondary">{label}</p>
      <p className="mt-0.5 truncate text-lg font-semibold tabular-nums text-text-primary">{value}</p>
      {sub && <p className="truncate text-[10px] tabular-nums text-text-secondary">{sub}</p>}
    </div>
  );
}