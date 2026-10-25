import useEquipmentTelemetry from "@/hooks/useEquipmentTelemetry";
import { formatFixed, formatMetric } from "@/utils/equipment/formatMetric";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import { useMemo } from "react";
import Badge from "@/components/Badge";
import EquipmentDetailLayout from "@/ui/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import EquipmentNumberSetting from "@/ui/Hud/equipment/details/_components/EquipmentNumberSetting";
import EquipmentChoiceSetting from "@/ui/Hud/equipment/details/_components/EquipmentChoiceSetting";
import EquipmentToggleSetting from "@/ui/Hud/equipment/details/_components/EquipmentToggleSetting";
import EquipmentEnabledSetting from "@/ui/Hud/equipment/details/_components/EquipmentEnabledSetting";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { beltConnections, beltLength } from "@/domain/conveyor/conveyorLayout";
import { SPEED_LIMITS } from "@/domain/simulation/equipmentSpeeds";
import type { ConveyorTurn } from "@/types/layout";
import SmoothValue from "@/ui/Hud/equipment/details/_components/SmoothValue";
import { MOCK_TELEMETRY_CONFIG } from "@/constants/telemetry";

const metric = (value: number | undefined, unit: string) => (
  <SmoothValue value={value} format={(v) => formatFixed(v, unit)} intervalMs={MOCK_TELEMETRY_CONFIG.intervalMs} className="tabular-nums" />
);

const TURN_LABELS: Record<ConveyorTurn, string> = { straight: "직선", left: "좌회전", right: "우회전" };

export default function ConveyorDetails({ object }: EquipmentDetailProps) {
  const objects = useSceneStore((state) => state.objects);
  const enabled = useSceneStore((state) => state.settings[object.id]?.enabled);
  const autoSpawn = useSceneStore((state) => state.settings[object.id]?.autoSpawn);
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
        { label: "모터 온도", value: metric(telemetry?.motorTemperatureC, "°C") },
        { label: "소비 전력", value: metric(telemetry?.powerKw, "kW") },
        { label: "모터 부하 (모의)", value: metric(telemetry?.motorLoadPercent, "%"), progress: telemetry?.motorLoadPercent },
      ]} />
    } settings={
      <DetailSection title="컨베이어 설정">
        <EquipmentNumberSetting id={object.id} field="beltSpeed" label="연결 컨베이어 속도" unit="m/min" {...SPEED_LIMITS.beltSpeed} />
        <EquipmentChoiceSetting
          id={object.id}
          field="conveyorRole"
          label="용도"
          fallback="box"
          options={[
            { value: "box", label: "박스 투입" },
            { value: "inbound", label: "입하 (박스 투입)" },
            { value: "fed", label: "로봇 투입 (자동 투입 없음)" },
            { value: "outbound", label: "출하 (AMR 팔레트 이송)" },
            { value: "ship", label: "출하 (박스 반출, 로봇 투입)" },
          ]}
        />
        <EquipmentChoiceSetting
          id={object.id}
          field="inboundUnit"
          label="입하 단위"
          fallback="box"
          options={[
            { value: "box", label: "박스" },
            { value: "pallet", label: "팔레트 (롤러 AMR로 이송)" },
          ]}
        />
        {incoming ? <p>앞 구간에서 넘어오는 박스를 이송합니다.</p> : (
          <>
            <EquipmentToggleSetting id={object.id} field="autoSpawn" label="자동 생성" fallback />
            {autoSpawn !== false && (
              <EquipmentNumberSetting id={object.id} field="spawnInterval" label="투입량" unit="개/h" {...SPEED_LIMITS.spawnInterval} />
            )}
          </>
        )}
        <EquipmentEnabledSetting id={object.id} />
      </DetailSection>
    }>

    </EquipmentDetailLayout>
  );
}
