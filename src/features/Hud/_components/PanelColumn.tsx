import type { ReactNode } from "react";
import { cn } from "@/lib/style";

export default function PanelColumn({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <div className={cn(
      "flex min-h-0 w-80 max-w-full min-w-0 shrink flex-col gap-4 overflow-y-auto rounded-md [scrollbar-color:#334155_transparent] [scrollbar-width:thin] max-sm:w-full max-sm:flex-1",
      right && "ml-auto max-sm:ml-0",
    )}>
      {children}
    </div>
  );
}
