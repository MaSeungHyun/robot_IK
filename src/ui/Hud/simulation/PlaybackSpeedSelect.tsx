import { useEffect, useState } from "react";
import Select from "@/components/Select";
import { PLAYBACK_SPEEDS } from "@/constants/playback";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { simulationClock } from "@/domain/simulation/simulationClock";

const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((speed) => ({
  value: String(speed),
  label: `${speed.toFixed(2)}x`,
}));
/** Achieved-speed readout refresh (ms): ~4 Hz, never per frame. */
const ACHIEVED_POLL_MS = 250;

/** Achieved sim speed while running (0 when paused), polled outside React's frame loop. */
function useAchievedSpeed(running: boolean) {
  const [achieved, setAchieved] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setAchieved(Math.round(simulationClock.stats.achievedSpeed * 10) / 10), ACHIEVED_POLL_MS);
    return () => window.clearInterval(id);
  }, [running]);
  return running ? achieved : 0;
}

/** Compact flat playback speed picker for the header, next to PLAY/STOP. The chosen speed never changes on its own;
 *  when the CPU cannot keep up, the achieved speed is shown next to it instead. */
export default function PlaybackSpeedSelect() {
  const speed = useSimulationStore((state) => state.speed);
  const setSpeed = useSimulationStore((state) => state.setSpeed);
  const running = useSimulationStore((state) => state.running);
  const achieved = useAchievedSpeed(running);
  const lagging = running && achieved > 0 && achieved < speed * 0.9;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-[#a0a4ab]">Speed</span>
      <Select
        label="전체 속도"
        value={String(speed)}
        options={SPEED_OPTIONS}
        onValueChange={(value) => setSpeed(Number(value))}
        widthClassName="w-20"
      />
      {lagging && (
        <span className="tabular-nums text-[#02dfef]" title="CPU 부하로 목표 배속을 따라가지 못하는 중 (설정 배속은 유지됩니다)">
          실제 {achieved.toFixed(1)}x
        </span>
      )}
    </div>
  );
}
