import useEquipmentTelemetry from "@/hooks/useEquipmentTelemetry";
import { formatMetric } from "@/utils/equipment/formatMetric";
import DetailRows from "@/features/Hud/equipment/details/_components/DetailRows";
import Badge from "@/components/Badge";
import AMRStatusBadge from "@/features/Hud/equipment/amr/AMRStatusBadge";
import EquipmentDetailLayout from "@/features/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/features/Hud/equipment/details/_components/DetailSection";
import EquipmentSpeedSetting from "@/features/Hud/equipment/details/_components/EquipmentSpeedSetting";
import EquipmentEnabledSetting from "@/features/Hud/equipment/details/_components/EquipmentEnabledSetting";
import type { EquipmentDetailProps } from "@/features/Hud/equipment/details/types";
import { useSimulationStore } from "@/stores/useSimulationStore";

export default function AMRDetails({ object }: EquipmentDetailProps) {
  const agent = useSimulationStore((state) => state.equipment?.agents.find((agent) => agent.id === object.id));
  const telemetry = useEquipmentTelemetry(object.id);

  const status = (
    agent ? <AMRStatusBadge state={agent.state} /> : <Badge tone="idle">준비 중</Badge>
  );

  return (
    <EquipmentDetailLayout object={object} status={status} summary={
      <DetailRows rows={[
        { label: "운반 상태", value: agent?.status },
        { label: "운반 대상", value: agent ? agent.target ?? "없음" : undefined },
        { label: "출고 횟수", value: formatMetric(agent?.completed, "회", 0) },
        { label: "모터 온도", value: formatMetric(telemetry?.motorTemperatureC, "°C") },
        { label: "소비 전력", value: formatMetric(telemetry?.powerKw, "kW") },
      ]} />
    } settings={
      <DetailSection title="AMR 설정">
        <EquipmentSpeedSetting id={object.id} />
        <EquipmentEnabledSetting id={object.id} />
      </DetailSection>
    }>

    </EquipmentDetailLayout>
  );
}
