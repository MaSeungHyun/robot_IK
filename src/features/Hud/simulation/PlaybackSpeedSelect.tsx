import Select from "@/components/Select";
import { PLAYBACK_SPEEDS } from "@/constants/playback";
import { useSimulationStore } from "@/stores/useSimulationStore";

const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((speed) => ({
  value: String(speed),
  label: `x ${speed}`,
}));

export default function PlaybackSpeedSelect() {
  const speed = useSimulationStore((state) => state.speed);
  const setSpeed = useSimulationStore((state) => state.setSpeed);
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs text-text-secondary">전체 속도</p>
      <Select
        label="전체 속도"
        value={String(speed)}
        options={SPEED_OPTIONS}
        onValueChange={(value) => setSpeed(Number(value))}
      />
    </div>
  );
}
