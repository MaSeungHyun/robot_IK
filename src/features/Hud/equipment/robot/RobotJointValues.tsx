import DetailRows from "@/features/Hud/equipment/details/_components/DetailRows";
import DetailSection from "@/features/Hud/equipment/details/_components/DetailSection";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { formatMetric } from "@/utils/equipment/formatMetric";

export default function RobotJointValues({ id }: { id: string }) {
  const readings = useSimulationStore((state) => state.robotJointAngles[id]);

  return (
    <DetailSection title="실시간 관절 각도">
      <p className="mb-2 text-[10px] text-text-secondary">
        실제 모델 값 · 0.1초 갱신
      </p>

      {readings?.length ? (
        <DetailRows
          rows={readings.map((joint, index) => ({
            label: `J${index + 1} · ${joint.name} (${joint.axis})`,
            value: (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                {formatMetric(joint.degrees, "°")}
                {/* {joint.locked && <Badge tone="idle">고정</Badge>} */}
              </span>
            ),
          }))}
        />
      ) : (
        <p className="text-xs text-text-secondary">
          관절 데이터를 준비하고 있습니다.
        </p>
      )}
    </DetailSection>
  );
}
