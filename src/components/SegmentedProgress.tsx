import { useLayoutEffect, useRef, useState } from "react";
import type { BadgeTone } from "@/components/Badge";
import { cn } from "@/lib/style";

const FILL: Record<BadgeTone | "brand", string> = {
  brand: "fill-brand-primary",
  safe: "fill-safe",
  operating: "fill-operating",
  fault: "fill-fault",
  warning: "fill-warning",
  idle: "fill-idle",
  offline: "fill-offline",
  info: "fill-info",
  charging: "fill-charging",
};

export type SegmentedProgressColor = keyof typeof FILL;

type Props = {
  /** Percent, 0-100 (clamped). */
  value: number;
  /** Number of segments. */
  count?: number;
  color?: SegmentedProgressColor;
  className?: string;
  label?: string;
  /** Pulses the filled segments, e.g. while a battery is charging. */
  pulse?: boolean;
};

/** Gap between segments in CSS pixels (scaled to device pixels). */
const GAP = 2;
/** Bar height in CSS pixels (matches h-2). */
const HEIGHT = 8;

type Layout = { cssW: number; dpr: number; offset: number };

/**
 * Full-width bar of `count` segments drawn as an SVG laid out in DEVICE pixels.
 * The viewBox maps 1 unit to 1 physical pixel, the rects start on the device
 * pixel grid (the container's fractional left edge is compensated) and every
 * segment gets the same whole-device-pixel width, so cells stay equal at any
 * browser zoom / devicePixelRatio. Leftover pixels stay empty at the end.
 */
export default function SegmentedProgress({
  value,
  count = 12,
  color = "brand",
  className,
  label,
  pulse = false,
}: Props) {
  const percent = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
  const segments = Math.max(1, Math.floor(count));
  const filled = Math.round((percent / 100) * segments);
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>({ cssW: 0, dpr: 1, offset: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let media: MediaQueryList | null = null;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = el.getBoundingClientRect();
      const leftDev = rect.left * dpr;
      const offset = Math.ceil(leftDev - 0.001) - leftDev;
      setLayout((prev) =>
        prev.cssW === rect.width &&
        prev.dpr === dpr &&
        Math.abs(prev.offset - offset) < 0.01
          ? prev
          : { cssW: rect.width, dpr, offset },
      );
    };
    const onDprChange = () => {
      measure();
      watchDpr();
    };
    const watchDpr = () => {
      media?.removeEventListener("change", onDprChange);
      media = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      );
      media.addEventListener("change", onDprChange);
    };
    measure();
    watchDpr();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      media?.removeEventListener("change", onDprChange);
    };
  }, []);

  const { cssW, dpr, offset } = layout;
  const viewW = cssW * dpr;
  const usable = Math.max(0, Math.floor(viewW - offset));
  const height = Math.max(1, Math.round(HEIGHT * dpr));
  let gap = Math.max(1, Math.round(GAP * dpr));
  let cell = Math.floor((usable - gap * (segments - 1)) / segments);
  if (cell < 2 && gap > 1) {
    gap = 1;
    cell = Math.floor((usable - gap * (segments - 1)) / segments);
  }
  cell = Math.max(1, cell);

  return (
    <div
      ref={ref}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 w-full min-w-0 overflow-hidden", className)}
    >
      {cssW > 0 && (
        <svg
          width={cssW}
          height={HEIGHT}
          viewBox={`0 0 ${viewW} ${height}`}
          preserveAspectRatio="none"
          shapeRendering="crispEdges"
          aria-hidden
          className="block"
        >
          {Array.from({ length: segments }, (_, i) => (
            <rect
              key={i}
              x={offset + i * (cell + gap)}
              y={0}
              width={cell}
              height={height}
              className={cn(
                "transition-colors",
                i < filled
                  ? cn(FILL[color], pulse && "animate-pulse")
                  : "fill-text-primary/10",
              )}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
