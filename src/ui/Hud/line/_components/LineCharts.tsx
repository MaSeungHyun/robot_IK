import type { CountSample, RobotTimeShare } from "@/stores/useDerivedMetricsStore";
import LineRateChart from "@/ui/Hud/line/LineRateChart";
import LineTimeShareDonut from "@/ui/Hud/line/LineTimeShareDonut";

/** Expanded view: production-rate trend next to the robot time-share donut. */
export default function LineCharts({ history, robotIds, share }: { history: CountSample[]; robotIds: string[]; share: RobotTimeShare }) {
  return (
    <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
      <div className="rounded-lg bg-white/[.035] p-2">
        <p className="text-[10px] text-text-secondary">
          생산 속도 (개/h · 최근 시뮬레이션 시간)
        </p>
        <LineRateChart history={history} robotIds={robotIds} />
      </div>
      <div className="rounded-lg bg-white/[.035] p-2">
        <p className="text-[10px] text-text-secondary">공정 시간 비율</p>
        <LineTimeShareDonut share={share} />
      </div>
    </div>
  );
}
