import { CircleDot } from "lucide-react";
import { BOX_COUNT } from "@/legacy/robot/RobotDemo";
import { useSimulationStore } from "@/stores/useSimulationStore";

export default function SimulationStatusPanel() {
  const sceneMode = useSimulationStore((state) => state.sceneMode);
  const running = useSimulationStore((state) => state.running);
  const status = useSimulationStore((state) => state.progress.status);
  const completed = useSimulationStore((state) =>
    state.sceneMode === "robot" ? state.progress.count : state.stats.placed,
  );
  const batch = sceneMode === "robot",
    amr = sceneMode === "amr";
  return (
    <section
      className="my-5 rounded-xl border border-white/5 bg-white/[.025] p-3.5"
      aria-label="로봇 상태"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-text-secondary">
          <CircleDot size={13} />
          {amr ? "AMR 상태" : "로봇 상태"}
        </span>
        <span className={running ? "text-emerald-300" : "text-text-secondary"}>
          {running ? "실행 중" : "대기"}
        </span>
      </div>
      <p className="mt-2 min-h-10 text-[13px] leading-5 text-text-primary">
        {status}
      </p>
      <div className="mt-3 flex items-end justify-between border-t border-white/5 pt-3">
        <span className="text-xs text-text-secondary">
          {amr ? "이송 완료" : "적재 완료"}
        </span>
        <span className="text-xl font-semibold tabular-nums text-white">
          {completed}
          <span className="ml-1 text-xs font-normal text-text-secondary">
            {batch ? `/ ${BOX_COUNT}` : "개"}
          </span>
        </span>
      </div>
    </section>
  );
}
