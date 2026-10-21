import Icon from "@/components/Icon";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { pause, play, stop } from "@/stores/actions/playback";
import { cn } from "@/lib/style";
import PlaybackSpeedSelect from "@/ui/Hud/simulation/PlaybackSpeedSelect";
import SimulationClock from "@/ui/Header/SimulationClock";

/** Active: same treatment as the header logo box (brand tint + brand-colored icon), same 20% tint. */
const ACCENT = "bg-brand-primary/20 text-brand-primary [&_svg]:fill-brand-primary hover:bg-brand-primary/30";
/** Inactive playback button: subtle neutral filled square, borderless like the logo box. */
const IDLE = "bg-white/[.06] text-text-primary/80 hover:bg-white/[.11] hover:text-text-primary";
const TOOL_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-1 focus-visible:ring-brand-primary disabled:pointer-events-none disabled:opacity-40";

export default function PlaybackControls() {
  const running = useSimulationStore((state) => state.running);
  const stopped = useSceneStore((state) => state.editing);

  return (
    <div className="flex items-center gap-4 max-lg:justify-end">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="실행"
          aria-pressed={running}
          className={cn(TOOL_BUTTON, running ? ACCENT : IDLE)}
          onClick={() => {
            if (!running) play();
          }}
        >
          <Icon icon="Play" aria-hidden="true" className="size-3.5 fill-current" />
        </button>
        <button
          type="button"
          aria-label="일시 정지"
          aria-pressed={!running && !stopped}
          className={cn(TOOL_BUTTON, !running && !stopped ? ACCENT : IDLE)}
          disabled={!running && stopped}
          onClick={() => (running ? pause() : play())}
        >
          <Icon icon="Pause" aria-hidden="true" className="size-3.5 fill-current" />
        </button>
        <button
          type="button"
          aria-label="정지"
          className={cn(TOOL_BUTTON, IDLE)}
          disabled={stopped}
          onClick={stop}
        >
          <Icon icon="Square" aria-hidden="true" strokeWidth={0} className="size-3 fill-current" />
        </button>
      </div>
      <PlaybackSpeedSelect />
      <SimulationClock />
    </div>
  );
}
