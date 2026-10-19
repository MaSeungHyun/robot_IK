import Badge from "@/components/Badge";
import DetailRows from "@/features/Hud/equipment/details/_components/DetailRows";
import DetailSection from "@/features/Hud/equipment/details/_components/DetailSection";
import type { EquipmentDetailProps } from "@/features/Hud/equipment/details/types";
import { EQUIPMENT_NAMES } from "@/stores/useSceneStore";
import useEquipmentTelemetry from "@/hooks/useEquipmentTelemetry";
import { formatMetric } from "@/utils/equipment/formatMetric";

export default function EquipmentMainInfo({ object }: EquipmentDetailProps) {
  const telemetry = useEquipmentTelemetry(object.id);
  const connection = telemetry?.connection;
  const metadata = object.metadata;
  const latency = formatMetric(connection?.latencyMs, "ms");

  return (
    <DetailSection title="기본 정보">
      <DetailRows rows={[
        { label: "유형", value: EQUIPMENT_NAMES[object.kind] },
        { label: "제조사", value: metadata?.manufacturer },
        { label: "모델", value: metadata?.model },
        { label: "설치 위치", value: metadata?.location },
        { label: "IP 주소", value: metadata?.ipAddress },
        { label: "연결", value: connection ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={connection.state === "online" ? "size-1.5 rounded-full bg-safe" : "size-1.5 rounded-full bg-offline"} />
            {connection.state === "online" ? `온라인${telemetry?.source === "simulation" ? " · 모의" : ""}${latency ? ` (${latency})` : ""}` : "오프라인"}
          </span>
        ) : <Badge tone="idle">미연결</Badge> },
        { label: "장비 ID", value: object.id },
        { label: "장면 위치", value: `${object.x.toFixed(2)}, ${object.z.toFixed(2)} m · ${Math.round(object.yaw * 180 / Math.PI)}°` },
      ]} />
    </DetailSection>
  );
}
