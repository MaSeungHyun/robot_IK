import type { ComponentProps } from "react";
import { cn } from "@/lib/style";

type PanelProps = ComponentProps<"aside"> & {
  embedded?: boolean;
};

export default function Panel({
  embedded = false,
  className,
  ...props
}: PanelProps) {
  return (
    <aside
      {...props}
      className={cn(
        "h-full flex-1 flex flex-col",
        embedded
          ? "pt-4"
          : "simulation-panel w-full shrink-0 rounded-md border border-white/10 bg-bg-white/70 p-4 shadow-xl backdrop-blur-md",
        className,
      )}
    />
  );
}
