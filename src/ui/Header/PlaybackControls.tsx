import Button from "@/components/Button";
import Icon from "@/components/Icon";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { pause, play, stop } from "@/stores/actions/playback";
import { cn } from "@/lib/style";
import PlaybackSpeedSelect from "@/ui/Hud/simulation/PlaybackSpeedSelect";

export default function PlaybackControls() {
  const running = useSimulationStore((state) => state.running);
  const stopped = useSceneStore((state) => state.editing);

  return (
    <div className="flex items-center gap-2 max-lg:justify-end">
      <div className="flex items-center gap-2">
        <Button
          aria-label={running ? "일시 정지" : "실행"}
          className="rounded-sm text-text-primary"
          active={running}
          onClick={() => (running ? pause() : play())}
        >
          <Icon
            icon={running ? "Pause" : "Play"}
            aria-hidden="true"
            className={cn(
              "size-4",
              running
                ? "text-brand-primary fill-brand-primary"
                : "text-brand-primary fill-none",
            )}
          />
        </Button>
        <Button
          aria-label="정지"
          className={cn(
            "rounded-sm",
            stopped ? "text-text-secondary" : "text-text-primary",
          )}
          disabled={stopped}
          onClick={stop}
        >
          <Icon
            icon="Square"
            aria-hidden="true"
            className={cn(
              "size-4",
              stopped ? "text-text-secondary" : "text-brand-primary",
            )}
          />
        </Button>
      </div>
      <PlaybackSpeedSelect />
    </div>
  );
}
