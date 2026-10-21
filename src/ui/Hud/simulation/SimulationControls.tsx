import Button from "@/components/Button";
import { useSimulationStore } from "@/stores/useSimulationStore";
import Icon from "@/components/Icon";

export default function SimulationControls() {
  const running = useSimulationStore((state) => state.running);
  const setRunning = useSimulationStore((state) => state.setRunning);
  const reset = useSimulationStore((state) => state.reset);

  return (
    <div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
      <Button onClick={() => setRunning((value) => !value)}>
        {running ? <Icon icon="Pause" /> : <Icon icon="Play" />}{" "}
        {running ? "일시 정지" : "시작"}
      </Button>

      <Button  onClick={reset} aria-label="초기화">
        <Icon icon="RotateCcw" />
        초기화
      </Button>
    </div>
  );
}
