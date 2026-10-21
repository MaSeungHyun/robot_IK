import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { formatFixed } from "@/utils/equipment/formatMetric";
import SmoothValue from "@/ui/Hud/equipment/details/_components/SmoothValue";
import { JOINT_READINGS_INTERVAL_MS, MOCK_TELEMETRY_CONFIG } from "@/constants/telemetry";
import useEquipmentTelemetry from "@/hooks/useEquipmentTelemetry";
import type { RobotJointSnapshot } from "@/types/robot";

const formatDegrees = (value: number) => formatFixed(value, "°");
const formatPercent = (value: number) => formatFixed(value, "%");

/** Degrees left to the nearer joint limit, or undefined when the joint has no limits. */
function limitMargin({ degrees, min, max }: RobotJointSnapshot) {
  if (min === undefined || max === undefined || !Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  return Math.max(0, Math.min(degrees - min, max - degrees));
}

export default function RobotJointValues({ id }: { id: string }) {
  const readings = useSimulationStore((state) => state.robotJointAngles[id]);
  const loads = useEquipmentTelemetry(id)?.jointLoadPercent;

  return (
    <>
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
              <SmoothValue
                className="inline-block w-12 text-right tabular-nums"
                value={joint.degrees}
                format={formatDegrees}
                intervalMs={JOINT_READINGS_INTERVAL_MS}
                angle
              />
            ),
          }))}
        />
      ) : (
        <p className="text-[11px] text-text-secondary">
          관절 데이터를 준비하고 있습니다.
        </p>
      )}
    </DetailSection>
    {readings?.length ? (
      <DetailSection title="관절 부하 · 한계 여유">
        <p className="mb-1.5 text-[11px] text-text-secondary">
          부하율은 모의값 · 한계 여유는 실제 관절 범위 기준
        </p>
        <DetailRows
          rows={readings.map((joint, index) => {
            const margin = limitMargin(joint);
            return {
              label: `J${index + 1} 부하 / 여유`,
              progress: loads?.[index],
              value: (
                <span className="inline-flex gap-1 tabular-nums">
                  <SmoothValue className="inline-block w-9 text-right" value={loads?.[index]} format={formatPercent} intervalMs={MOCK_TELEMETRY_CONFIG.intervalMs} />
                  <span className="text-text-secondary">·</span>
                  {margin === undefined || joint.locked ? <span className="w-12 text-right text-text-secondary">무제한</span> : (
                    <SmoothValue className="inline-block w-12 text-right" value={margin} format={formatDegrees} intervalMs={JOINT_READINGS_INTERVAL_MS} />
                  )}
                </span>
              ),
            };
          })}
        />
      </DetailSection>
    ) : null}
    </>
  );
}
