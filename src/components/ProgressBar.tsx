import type { BadgeTone } from "@/components/Badge";
import { cn } from "@/lib/style";
import SegmentedProgress from "@/components/SegmentedProgress";

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
  /** Segment count (default 20). */
  segments?: number;
};

const TEXT_TONES: Record<BadgeTone, string> = {
  safe: "text-safe",
  operating: "text-operating",
  fault: "text-fault",
  warning: "text-warning",
  idle: "text-idle",
  offline: "text-offline",
  info: "text-info",
  charging: "text-charging",
};

/** Horizontal 0-100% segmented bar (SegmentedProgress) using the shared status tone tokens. */
export default function ProgressBar({
  label,
  value,
  tone = "operating",
  showValue = true,
  className,
  pulse = false,
  caption,
  segments = 20,
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
      <SegmentedProgress
        label={label}
        value={percentage}
        count={segments}
        color={tone}
        pulse={pulse}
        className="flex-1"
      />
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
