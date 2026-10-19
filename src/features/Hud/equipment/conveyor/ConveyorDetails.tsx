import useEquipmentTelemetry from "@/hooks/useEquipmentTelemetry";
import { formatMetric } from "@/utils/equipment/formatMetric";
import DetailRows from "@/features/Hud/equipment/details/_components/DetailRows";
import { useMemo } from "react";
import Badge from "@/components/Badge";
import EquipmentDetailLayout from "@/features/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/features/Hud/equipment/details/_components/DetailSection";
import EquipmentSpeedSetting from "@/features/Hud/equipment/details/_components/EquipmentSpeedSetting";
import EquipmentNumberSetting from "@/features/Hud/equipment/details/_components/EquipmentNumberSetting";
import EquipmentEnabledSetting from "@/features/Hud/equipment/details/_components/EquipmentEnabledSetting";
import type { EquipmentDetailProps } from "@/features/Hud/equipment/details/types";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { beltConnections, beltLength } from "@/utils/conveyor/conveyorLayout";
import type { ConveyorTurn } from "@/types/layout";

const TURN_LABELS: Record<ConveyorTurn, string> = { straight: "직선", left: "좌회전", right: "우회전" };

export default function ConveyorDetails({ object }: EquipmentDetailProps) {
  const objects = useSceneStore((state) => state.objects);
  const enabled = useSceneStore((state) => state.settings[object.id]?.enabled);
  const running = useSimulationStore((state) => state.running);
  const telemetry = useEquipmentTelemetry(object.id);

  const connections = useMemo(() => beltConnections(objects), [objects]);
  const incoming = connections.incoming.has(object.id);
  const previousId = Array.from(connections.next).find(([, next]) => next.id === object.id)?.[0];
  const previous = objects.find((candidate) => candidate.id === previousId);
  const next = connections.next.get(object.id);

  const status = (
    <Badge tone={!enabled ? "offline" : running ? "operating" : "idle"}>
      {!enabled ? "중지" : running ? "이송 중" : "일시 정지"}
    </Badge>
  );

  return (
    <EquipmentDetailLayout object={object} status={status} summary={
      <DetailRows rows={[
        { label: "구간 형태", value: TURN_LABELS[object.conveyorTurn ?? "straight"] },
        { label: "구간 길이", value: formatMetric(beltLength(object), "m", 2) },
        { label: "앞 구간", value: previous?.name ?? "없음 · 박스 생성 구간" },
        { label: "다음 구간", value: next?.name ?? "없음 · 라인 종료" },
        { label: "모터 온도", value: formatMetric(telemetry?.motorTemperatureC, "°C") },
        { label: "소비 전력", value: formatMetric(telemetry?.powerKw, "kW") },
      ]} />
    } settings={
      <DetailSection title="컨베이어 설정">
        <EquipmentSpeedSetting id={object.id} connected />
        {incoming ? <p>앞 구간에서 넘어오는 박스를 이송합니다.</p> : (
          <EquipmentNumberSetting id={object.id} field="spawnInterval" label="박스 생성 간격 s" min={2} max={30} step={1} />
        )}
        <EquipmentEnabledSetting id={object.id} />
      </DetailSection>
    }>

    </EquipmentDetailLayout>
  );
}
