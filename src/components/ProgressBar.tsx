import type { BadgeTone } from "@/components/Badge";
import { cn } from "@/lib/style";

type Props = {
  /** Accessible name of the bar. */
  label: string;
  /** Optional visible metric name shown before the bar, e.g. "배터리". */
  caption?: string;
  value: number;
  tone?: BadgeTone;
  showValue?: boolean;
  className?: string;
  /** Pulses the bar, e.g. while a battery is charging. */
  pulse?: boolean;
};

const BAR_TONES: Record<BadgeTone, string> = {
  safe: "bg-safe",
  operating: "bg-operating",
  fault: "bg-fault",
  warning: "bg-warning",
  idle: "bg-idle",
  offline: "bg-offline",
  info: "bg-info",
};

const TEXT_TONES: Record<BadgeTone, string> = {
  safe: "text-safe",
  operating: "text-operating",
  fault: "text-fault",
  warning: "text-warning",
  idle: "text-idle",
  offline: "text-offline",
  info: "text-info",
};

/** Horizontal 0-100% bar using the shared status tone tokens. */
export default function ProgressBar({
  label,
  value,
  tone = "operating",
  showValue = true,
  className,
  pulse = false,
  caption,
}: Props) {
  const percentage = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {caption && (
        <span className="w-10 shrink-0 text-xs text-text-secondary">
          {caption}
        </span>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            BAR_TONES[tone],
            pulse && "animate-pulse",
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showValue && (
        <span
          className={cn(
            "w-8 shrink-0 text-right text-xs font-medium tabular-nums",
            TEXT_TONES[tone],
          )}
        >
          {percentage.toFixed(0)}%
        </span>
      )}
    </div>
  );
}
