import Icon from "@/components/Icon";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { pause, play, stop } from "@/stores/actions/playback";
import { cn } from "@/lib/style";
import PlaybackSpeedSelect from "@/ui/Hud/simulation/PlaybackSpeedSelect";

const ACCENT = "bg-brand-primary text-slate-950";
const TOOL_BUTTON =
  "flex size-7 items-center justify-center rounded-[3px] outline-none focus-visible:ring-1 focus-visible:ring-brand-primary disabled:opacity-40";

export default function PlaybackControls() {
  const running = useSimulationStore((state) => state.running);
  const stopped = useSceneStore((state) => state.editing);

  return (
    <div className="flex items-center gap-3 max-lg:justify-end">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="실행"
          aria-pressed={running}
          className={cn(TOOL_BUTTON, running ? ACCENT : "text-[#a0a4ab] hover:bg-white/5")}
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
          className={cn(TOOL_BUTTON, !running && !stopped ? ACCENT : "text-[#a0a4ab] hover:bg-white/5")}
          disabled={!running && stopped}
          onClick={() => (running ? pause() : play())}
        >
          <Icon icon="Pause" aria-hidden="true" className="size-3.5 fill-current" />
        </button>
        <button
          type="button"
          aria-label="정지"
          className={cn(TOOL_BUTTON, "text-[#a0a4ab] hover:bg-white/5")}
          disabled={stopped}
          onClick={stop}
        >
          <Icon icon="Square" aria-hidden="true" className="size-3 fill-current" />
        </button>
      </div>
      <PlaybackSpeedSelect />
    </div>
  );
}
