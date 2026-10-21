import { useEffect, useRef } from "react";
import { HEADER_CLOCK } from "@/constants/hud";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { formatSimTime } from "@/utils/formatSimTime";

/**
 * Elapsed simulation time from the simulator snapshot (`equipment.elapsed`, published every 250 ms), advanced
 * between snapshots by wall time × playback speed so it ticks smoothly. Written straight into the DOM (~30 Hz).
 * Resets to 0 when the run stops (snapshot cleared).
 */
export default function SimulationClock() {
  const text = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0, lastWrite = 0, base = 0, baseAt = 0, shown = 0;
    let source = useSimulationStore.getState().equipment;
    const unsubscribe = useSimulationStore.subscribe((state) => {
      if (state.equipment === source) return;
      source = state.equipment;
      base = source?.elapsed ?? 0;
      baseAt = performance.now();
      if (!source) shown = 0;
    });
    base = source?.elapsed ?? 0;
    baseAt = performance.now();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastWrite < HEADER_CLOCK.updateMs || !text.current) return;
      lastWrite = now;
      const { running, speed } = useSimulationStore.getState();
      // Extrapolate at most one report interval ahead, and never run backwards.
      const ahead = running && source ? Math.min(((now - baseAt) / 1000) * speed, HEADER_CLOCK.maxExtrapolationS * speed) : 0;
      shown = source ? Math.max(shown, base + ahead) : 0;
      const value = formatSimTime(shown);
      if (text.current.textContent !== value) text.current.textContent = value;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-text-secondary">Sim Time</span>
      <span ref={text} className="w-[88px] font-mono tabular-nums text-text-primary">00:00:00.000</span>
    </div>
  );
}
