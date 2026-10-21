import { useEffect, useRef } from "react";
import { TELEMETRY_INTERPOLATION } from "@/constants/telemetry";
import { BufferedScalar } from "@/lib/interpolation";
import { cn } from "@/lib/style";

type Props = {
  value: number | undefined;
  format: (value: number) => string | undefined;
  /** Expected interval between incoming samples (ms); the display renders this far behind. */
  intervalMs: number;
  angle?: boolean;
  className?: string;
};

/** Numeric readout that glides between discrete samples. Writes textContent via rAF (no per-frame React render). */
export default function SmoothValue({ value, format, intervalMs, angle = false, className }: Props) {
  const node = useRef<HTMLSpanElement>(null);
  const buffer = useRef<BufferedScalar | null>(null);
  const formatRef = useRef(format);

  useEffect(() => {
    formatRef.current = format;
  });

  useEffect(() => {
    buffer.current = new BufferedScalar(intervalMs, intervalMs * TELEMETRY_INTERPOLATION.smoothingTauRatio, angle);
  }, [intervalMs, angle]);

  useEffect(() => {
    if (value !== undefined && Number.isFinite(value)) buffer.current?.push(value, performance.now());
  }, [value]);

  useEffect(() => {
    let frame = 0, lastWrite = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const current = buffer.current?.sample(now);
      if (now - lastWrite < TELEMETRY_INTERPOLATION.textUpdateMs || !node.current) return;
      lastWrite = now;
      const text = current === undefined ? "—" : (formatRef.current(current) ?? "—");
      if (node.current.textContent !== text) node.current.textContent = text;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <span ref={node} className={cn("tabular-nums", className)}>—</span>;
}
