import useEquipmentTelemetry from "@/hooks/useEquipmentTelemetry";
import { formatFixed, formatMetric } from "@/utils/equipment/formatMetric";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import Badge from "@/components/Badge";
import AMRStatusBadge from "@/ui/Hud/equipment/amr/AMRStatusBadge";
import EquipmentDetailLayout from "@/ui/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import EquipmentNumberSetting from "@/ui/Hud/equipment/details/_components/EquipmentNumberSetting";
import { SPEED_LIMITS } from "@/domain/simulation/equipmentSpeeds";
import EquipmentEnabledSetting from "@/ui/Hud/equipment/details/_components/EquipmentEnabledSetting";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import { useSimulationStore } from "@/stores/useSimulationStore";
import AMRLivePose from "@/ui/Hud/equipment/amr/AMRLivePose";
import SmoothValue from "@/ui/Hud/equipment/details/_components/SmoothValue";
import { MOCK_TELEMETRY_CONFIG } from "@/constants/telemetry";
import { useDerivedMetricsStore } from "@/stores/useDerivedMetricsStore";

const metric = (value: number | undefined, unit: string) => (
  <SmoothValue value={value} format={(v) => formatFixed(v, unit)} intervalMs={MOCK_TELEMETRY_CONFIG.intervalMs} className="tabular-nums" />
);

/** Simulated seconds → "m분 s초". */
const formatDuration = (seconds: number) => {
  const total = Math.round(seconds);
  return total >= 60 ? `${Math.floor(total / 60)}분 ${total % 60}초` : `${total}초`;
};

export default function AMRDetails({ object }: EquipmentDetailProps) {
  const agent = useSimulationStore((state) => state.equipment?.agents.find((agent) => agent.id === object.id));
  const telemetry = useEquipmentTelemetry(object.id);
  const history = useDerivedMetricsStore((state) => state.agents[object.id]);
  const charging = agent?.state === "charging";
  const chargeSeconds = charging && history?.chargeRate ? Math.max(0, 100 - history.battery) / history.chargeRate : undefined;

  const status = (
    agent ? <AMRStatusBadge state={agent.state} /> : <Badge tone="idle">준비 중</Badge>
  );

  return (
    <EquipmentDetailLayout object={object} status={status} summary={
      <DetailRows rows={[
        { label: "운반 상태", value: agent?.status },
        { label: "운반 대상", value: agent ? agent.target ?? "없음" : undefined },
        { label: "현재 위치", value: <AMRLivePose id={object.id} field="position" /> },
        { label: "진행 방향", value: <AMRLivePose id={object.id} field="heading" /> },
        { label: "현재 속도", value: <AMRLivePose id={object.id} field="speed" /> },
        { label: "적재 중량 (모의)", value: metric(telemetry?.payloadKg, "kg") },
        { label: "충전 완료까지", value: charging ? (chargeSeconds === undefined ? "계산 중" : formatDuration(chargeSeconds)) : "충전 중 아님" },
        { label: "대기·정체 시간", value: history ? formatDuration(history.waitSeconds) : undefined },
        { label: "출고 횟수", value: formatMetric(agent?.completed, "회", 0) },
        { label: "모터 온도", value: metric(telemetry?.motorTemperatureC, "°C") },
        { label: "소비 전력", value: metric(telemetry?.powerKw, "kW") },
      ]} />
    } settings={
      <DetailSection title="AMR 설정">
        <EquipmentNumberSetting id={object.id} field="amrSpeed" label="최대 주행 속도" unit="m/s" {...SPEED_LIMITS.amrSpeed} />
        <EquipmentEnabledSetting id={object.id} />
      </DetailSection>
    }>

    </EquipmentDetailLayout>
  );
}
