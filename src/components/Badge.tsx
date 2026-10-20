import type { ComponentProps } from "react";
import { cn } from "@/lib/style";

export type BadgeTone =
  | "safe"
  | "operating"
  | "fault"
  | "warning"
  | "idle"
  | "offline"
  | "info";

type Props = ComponentProps<"span"> & { tone?: BadgeTone };

const TONE_STYLES: Record<BadgeTone, string> = {
  safe: "border-safe/25 bg-safe/10 text-safe",
  operating: "border-operating/25 bg-operating/10 text-operating",
  fault: "border-fault/25 bg-fault/10 text-fault",
  warning: "border-warning/25 bg-warning/10 text-warning",
  idle: "border-idle/25 bg-idle/10 text-idle",
  offline: "border-offline/25 bg-offline/10 text-offline",
  info: "border-info/25 bg-info/10 text-info",
};

export default function Badge({
  tone = "idle",
  className,
  children,
  ...props
}: Props) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4",
        TONE_STYLES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
