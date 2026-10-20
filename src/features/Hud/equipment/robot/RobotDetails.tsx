import RobotJointValues from "@/features/Hud/equipment/robot/RobotJointValues";
import useEquipmentTelemetry from "@/hooks/useEquipmentTelemetry";
import { formatMetric } from "@/utils/equipment/formatMetric";
import DetailRows from "@/features/Hud/equipment/details/_components/DetailRows";
import Badge from "@/components/Badge";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import RobotStatusBadge from "@/features/Hud/equipment/robot/RobotStatusBadge";
import EquipmentDetailLayout from "@/features/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/features/Hud/equipment/details/_components/DetailSection";
import EquipmentSpeedSetting from "@/features/Hud/equipment/details/_components/EquipmentSpeedSetting";
import EquipmentNumberSetting from "@/features/Hud/equipment/details/_components/EquipmentNumberSetting";
import EquipmentEnabledSetting from "@/features/Hud/equipment/details/_components/EquipmentEnabledSetting";
import type { EquipmentDetailProps } from "@/features/Hud/equipment/details/types";
import { useSimulationStore } from "@/stores/useSimulationStore";

export default function RobotDetails({ object }: EquipmentDetailProps) {
  const robot = useSimulationStore((state) =>
    state.equipment?.robots.find((robot) => robot.id === object.id),
  );
  const telemetry = useEquipmentTelemetry(object.id);

  const status = robot ? (
    <RobotStatusBadge state={robot.state} />
  ) : (
    <Badge tone="idle">준비 중</Badge>
  );

  return (
    <EquipmentDetailLayout
      object={object}
      status={status}
      summary={
        <DetailRows
          rows={[
            {
              label: "모터 온도",
              value: formatMetric(telemetry?.motorTemperatureC, "°C"),
            },
            {
              label: "컨트롤러 온도",
              value: formatMetric(telemetry?.controllerTemperatureC, "°C"),
            },
            {
              label: "가동률",
              value: formatMetric(robot?.utilization, "%"),
              progress: robot?.utilization,
            },
            {
              label: "사이클 시간",
              value: formatMetric(telemetry?.cycleTimeSeconds, "s"),
            },
            {
              label: "소비 전력",
              value: formatMetric(telemetry?.powerKw, "kW"),
            },
            { label: "프로그램", value: telemetry?.program },
            { label: "현재 부품", value: telemetry?.currentPart },
            {
              label: "동작 횟수",
              value: formatMetric(telemetry?.operationCount, "회", 0),
            },
            { label: "처리 수량", value: formatMetric(robot?.count, "개", 0) },
            { label: "현재 동작", value: robot?.status },
          ]}
        />
      }
      settings={
        <DetailSection title="로봇 설정">
          <EquipmentSpeedSetting id={object.id} />
          <EquipmentNumberSetting
            id={object.id}
            field="reach"
            label="집기 범위 m"
            min={0.5}
            max={SIMULATOR_CONFIG.reach}
            step={0.1}
          />
          <EquipmentEnabledSetting id={object.id} />
        </DetailSection>
      }
    >
      <RobotJointValues id={object.id} />
    </EquipmentDetailLayout>
  );
}
