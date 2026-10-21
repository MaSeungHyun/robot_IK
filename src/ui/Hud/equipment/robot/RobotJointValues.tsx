import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { formatMetric } from "@/utils/equipment/formatMetric";

export default function RobotJointValues({ id }: { id: string }) {
  const readings = useSimulationStore((state) => state.robotJointAngles[id]);

  return (
    <DetailSection title="실시간 관절 각도">
      <p className="mb-1.5 text-[11px] text-text-secondary">
        실제 모델 값 · 0.1초 갱신
      </p>

      {readings?.length ? (
        <DetailRows
          rows={readings.map((joint, index) => ({
            label: `J${index + 1} · ${joint.name} (${joint.axis})`,
            // Position of the angle within -180°..180°, drawn as a thin bar.
            progress: ((joint.degrees + 180) / 360) * 100,
            value: (
              <span className="inline-block w-12 text-right tabular-nums">
                {formatMetric(joint.degrees, "°")}
              </span>
            ),
          }))}
        />
      ) : (
        <p className="text-[11px] text-text-secondary">
          관절 데이터를 준비하고 있습니다.
        </p>
      )}
    </DetailSection>
  );
}
