import type { ReactNode } from "react";
import { cn } from "@/lib/style";

/**
 * Right: inspector column docked flush to the viewport edge (full height below the header, inner 1px border,
 * panels inside lose their floating card look). Left: floating column (edit-mode placement errors) with a small
 * offset; it sits in the HUD area to the right of the AssetRail, so it never overlaps the rail.
 */
export default function PanelColumn({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <div className={cn(
      "absolute z-200 flex w-80 max-w-full min-w-0 flex-col empty:hidden",
      right
        ? "simulation-panel inset-y-0 right-0 overflow-y-auto scrollbar-thin border-l border-white/10 bg-bg-primary/85 backdrop-blur-lg max-sm:w-full [&>.simulation-panel]:rounded-none [&>.simulation-panel]:border-0 [&>.simulation-panel]:bg-transparent [&>.simulation-panel]:shadow-none [&>.simulation-panel]:backdrop-blur-none"
        : "top-3 left-3 max-h-[calc(100%-1.5rem)] gap-4 overflow-y-auto scrollbar-thin rounded-md max-sm:w-[calc(100%-1.5rem)]",
    )}>
      {children}
    </div>
  );
}
