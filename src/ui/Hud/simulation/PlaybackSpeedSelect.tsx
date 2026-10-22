import Select from "@/components/Select";
import { PLAYBACK_SPEEDS } from "@/constants/playback";
import { useSimulationStore } from "@/stores/useSimulationStore";

const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((speed) => ({
  value: String(speed),
  label: `${speed.toFixed(2)}x`,
}));

/** Compact flat playback speed picker for the header, next to PLAY/STOP. */
export default function PlaybackSpeedSelect() {
  const speed = useSimulationStore((state) => state.speed);
  const setSpeed = useSimulationStore((state) => state.setSpeed);
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
    </div>
  );
}