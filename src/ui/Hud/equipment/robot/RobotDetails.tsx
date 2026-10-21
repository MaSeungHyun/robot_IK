import RobotJointValues from "@/ui/Hud/equipment/robot/RobotJointValues";
import useEquipmentTelemetry from "@/hooks/useEquipmentTelemetry";
import { formatFixed, formatMetric } from "@/utils/equipment/formatMetric";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import Badge from "@/components/Badge";
import RobotStatusBadge from "@/ui/Hud/equipment/robot/RobotStatusBadge";
import EquipmentDetailLayout from "@/ui/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import EquipmentSpeedSetting from "@/ui/Hud/equipment/details/_components/EquipmentSpeedSetting";
import EquipmentNumberSetting from "@/ui/Hud/equipment/details/_components/EquipmentNumberSetting";
import EquipmentChoiceSetting from "@/ui/Hud/equipment/details/_components/EquipmentChoiceSetting";
import EquipmentEnabledSetting from "@/ui/Hud/equipment/details/_components/EquipmentEnabledSetting";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import { useSimulationStore } from "@/stores/useSimulationStore";
import SmoothValue from "@/ui/Hud/equipment/details/_components/SmoothValue";
import { EQUIPMENT_REPORT_INTERVAL_MS, MOCK_TELEMETRY_CONFIG } from "@/constants/telemetry";

const metric = (value: number | undefined, unit: string) => (
  <SmoothValue value={value} format={(v) => formatFixed(v, unit)} intervalMs={MOCK_TELEMETRY_CONFIG.intervalMs} className="tabular-nums" />
);

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
              value: metric(telemetry?.motorTemperatureC, "°C"),
            },
            {
              label: "컨트롤러 온도",
              value: metric(telemetry?.controllerTemperatureC, "°C"),
            },
            {
              label: "가동률",
              value: <SmoothValue value={robot?.utilization} format={(v) => formatFixed(v, "%")} intervalMs={EQUIPMENT_REPORT_INTERVAL_MS} className="tabular-nums" />,
              progress: robot?.utilization,
            },
            {
              label: "사이클 시간",
              value: metric(telemetry?.cycleTimeSeconds, "s"),
            },
            {
              label: "소비 전력",
              value: metric(telemetry?.powerKw, "kW"),
            },
            { label: "흡착 압력 (모의)", value: metric(telemetry?.suctionKPa, "kPa") },
            { label: "파지 박스 중량 (모의)", value: metric(telemetry?.heldBoxKg, "kg") },
            { label: "프로그램", value: telemetry?.program },
            { label: "현재 부품", value: telemetry?.currentPart },
            {
              label: "동작 횟수",
              value: formatMetric(telemetry?.operationCount, "회", 0),
            },
            { label: "처리 수량", value: formatMetric(robot?.count, "개", 0) },
            { label: "현재 동작", value: robot?.status.split("·")[0] },
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
            min={0}
            exclusiveMin
            step={0.1}
          />
          <EquipmentChoiceSetting
            id={object.id}
            field="pickFilter"
            label="집기 대상"
            fallback="all"
            options={[
              { value: "all", label: "전체" },
              { value: "normal", label: "정상품만" },
              { value: "defect", label: "불량품만" },
            ]}
          />
          <EquipmentEnabledSetting id={object.id} />
        </DetailSection>
      }
    >
      <RobotJointValues id={object.id} />
    </EquipmentDetailLayout>
  );
}
