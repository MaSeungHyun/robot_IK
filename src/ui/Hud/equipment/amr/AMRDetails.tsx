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
import { useSceneStore } from "@/stores/useSceneStore";
import { amrModelOf, isForkliftRole } from "@/types/layout";
import EquipmentChoiceSetting from "@/ui/Hud/equipment/details/_components/EquipmentChoiceSetting";
import DeckBaseSetting from "@/ui/Hud/equipment/amr/DeckBaseSetting";
import ForkliftSettings from "@/ui/Hud/equipment/amr/ForkliftSettings";
import StopPointSetting from "@/ui/Hud/equipment/details/_components/StopPointSetting";
import AMRLivePose from "@/ui/Hud/equipment/amr/AMRLivePose";
import SmoothValue from "@/ui/Hud/equipment/details/_components/SmoothValue";
import { MOCK_TELEMETRY_CONFIG } from "@/constants/telemetry";
import { useDerivedMetricsStore } from "@/stores/useDerivedMetricsStore";
import { CATEGORY_LABEL, OPERATION_LABEL } from "@/domain/state/equipmentState";

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
  const role = useSceneStore((state) => state.settings[object.id]?.amrRole);
  const forklift = isForkliftRole(role);
  const model = amrModelOf(role);
  const history = useDerivedMetricsStore((state) => state.agents[object.id]);
  const charging = agent?.state === "charging";
  const chargeSeconds = charging && history?.chargeRate ? Math.max(0, 100 - history.battery) / history.chargeRate : undefined;

  const status = (
    agent ? <AMRStatusBadge state={agent.state} /> : <Badge tone="idle">준비 중</Badge>
  );

  return (
    <EquipmentDetailLayout object={object} status={status} summary={
      <DetailRows rows={[
        { label: "장비 상태", value: agent?.operation ? `${agent.category ? `${CATEGORY_LABEL[agent.category]} · ` : ""}${OPERATION_LABEL[agent.operation]}` : undefined },
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
    } settings={forklift ? <ForkliftSettings id={object.id} /> : (
      <DetailSection title="AMR 설정">
        <EquipmentChoiceSetting
          id={object.id}
          field="amrRole"
          label="역할"
          fallback="pallet"
          info="역할을 바꿔도 모델은 바뀌지 않습니다. 지게차·AGV는 에셋 목록에서 해당 장비로 배치하세요. 지게차 옵션은 지게차를 선택하면 '지게차 설정'에 있습니다."
          options={model === "agv"
              ? [{ value: "agv", label: "AGV (Rack_m 운반)" }]
              : [{ value: "pallet", label: "팔레트 AMR (출고 운반)" }, { value: "shuttle", label: "셔틀 AMR (팔레트 순환)" }]}
        />
        <DeckBaseSetting id={object.id} />
        <EquipmentNumberSetting id={object.id} field="amrSpeed" label="최대 주행 속도" unit="m/s" {...SPEED_LIMITS.amrSpeed} />
        <StopPointSetting id={object.id} roles={model === "agv" ? ["rackDrop"] : ["ship"]} />
        <EquipmentEnabledSetting id={object.id} />
      </DetailSection>
    )
    }>
    </EquipmentDetailLayout>
  );
}
