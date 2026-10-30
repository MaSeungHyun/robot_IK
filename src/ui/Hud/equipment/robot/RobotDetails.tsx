import { ROBOT_REACH_MAX } from "@/constants/simulatorLayout";
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
import { useSceneStore } from "@/stores/useSceneStore";
import SmoothValue from "@/ui/Hud/equipment/details/_components/SmoothValue";
import { EQUIPMENT_REPORT_INTERVAL_MS, MOCK_TELEMETRY_CONFIG } from "@/constants/telemetry";
import { OPERATION_LABEL } from "@/domain/state/equipmentState";
import { ROBOT_PEDESTAL_OPTIONS } from "@/constants/robotPedestal";
import StopPointSetting from "@/ui/Hud/equipment/details/_components/StopPointSetting";

const metric = (value: number | undefined, unit: string) => (
  <SmoothValue value={value} format={(v) => formatFixed(v, unit)} intervalMs={MOCK_TELEMETRY_CONFIG.intervalMs} className="tabular-nums" />
);

export default function RobotDetails({ object }: EquipmentDetailProps) {
  const robot = useSimulationStore((state) =>
    state.equipment?.robots.find((robot) => robot.id === object.id),
  );
  const telemetry = useEquipmentTelemetry(object.id);
  const depalletizer = useSceneStore((state) => state.settings[object.id]?.robotRole === "depalletize");

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
            { label: "장비 상태", value: robot?.operation ? OPERATION_LABEL[robot.operation] : undefined },
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
            max={ROBOT_REACH_MAX}
            label="집기 범위 m"
            min={0}
            exclusiveMin
            step={0.1}
          />
          <EquipmentChoiceSetting
            id={object.id}
            field="robotRole"
            label="작업"
            fallback="palletize"
            options={[
              { value: "depalletize", label: "적재 (팔레트 → 컨베이어, 미검수품)" },
              { value: "palletize", label: "하역 (검수 박스 → 팔레트)" },
            ]}
          />
          {!depalletizer && (
            <EquipmentChoiceSetting
              id={object.id}
              field="pickFilter"
              label="하역 등급"
              fallback="normal"
              info="미지정(기존 레이아웃)은 등급 구분 없이 집습니다."
              options={[
                { value: "normal", label: "정상" },
                { value: "defect", label: "불량" },
              ]}
            />
          )}
          <EquipmentChoiceSetting
            id={object.id}
            field="robotPedestal"
            label="받침대"
            fallback="none"
            options={ROBOT_PEDESTAL_OPTIONS}
          />
          <RobotPedestalYawSetting id={object.id} />
          <StopPointSetting id={object.id} roles={["unload"]} />
          <EquipmentEnabledSetting id={object.id} />
        </DetailSection>
      }
    >
      <RobotJointValues id={object.id} />
    </EquipmentDetailLayout>
  );
}

/** Pedestal-only turn (degrees, relative to the robot); hidden without a pedestal. */
function RobotPedestalYawSetting({ id }: { id: string }) {
  const pedestal = useSceneStore((state) => state.settings[id]?.robotPedestal ?? "none");
  if (pedestal === "none") return null;
  return <EquipmentNumberSetting id={id} field="robotPedestalYaw" label="받침대 회전" unit="°" min={-180} max={180} />;
}
