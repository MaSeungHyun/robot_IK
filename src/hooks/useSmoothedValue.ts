import { useEffect, useRef, useState } from "react";
import { TELEMETRY_INTERPOLATION } from "@/constants/telemetry";
import { BufferedScalar } from "@/lib/interpolation";

/**
 * Smoothed copy of a discretely-updated number for HUD props (e.g. progress bars).
 * Interpolates per animation frame but re-renders at most every `textUpdateMs`, and only while moving.
 */
export default function useSmoothedValue(value: number | undefined, intervalMs: number, angle = false) {
  const [smoothed, setSmoothed] = useState(value);
  const buffer = useRef<BufferedScalar | null>(null);

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
      if (current === undefined || now - lastWrite < TELEMETRY_INTERPOLATION.textUpdateMs) return;
      lastWrite = now;
      setSmoothed((previous) => (previous !== undefined && Math.abs(previous - current) < 1e-3 ? previous : current));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return value === undefined ? undefined : smoothed;
}
