import { formatMetric } from "@/utils/equipment/formatMetric";
import DetailRows from "@/features/Hud/equipment/details/_components/DetailRows";
import Badge from "@/components/Badge";
import EquipmentDetailLayout from "@/features/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/features/Hud/equipment/details/_components/DetailSection";
import EquipmentEnabledSetting from "@/features/Hud/equipment/details/_components/EquipmentEnabledSetting";
import { DETAIL_INPUT_CLASS_NAME } from "@/features/Hud/equipment/details/styles";
import type { EquipmentDetailProps } from "@/features/Hud/equipment/details/types";
import ScannerSettings from "@/features/Hud/equipment/scanner/ScannerSettings";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";

export default function ScannerDetails({ object }: EquipmentDetailProps) {
  const scanner = useSimulationStore((state) => state.equipment?.scanners?.find((scanner) => scanner.id === object.id));
  const enabled = useSceneStore((state) => state.settings[object.id]?.enabled);
  const passRate = scanner && scanner.scanned > 0 ? (scanner.scanned - scanner.faults) / scanner.scanned * 100 : undefined;

  const status = (
    <Badge tone={!enabled ? "offline" : scanner?.lastResult ?? "idle"}>
      {!enabled ? "중지" : scanner?.lastResult === "safe" ? "최근 통과" : scanner?.lastResult === "fault" ? "최근 불량" : "검사 대기"}
    </Badge>
  );

  return (
    <EquipmentDetailLayout object={object} status={status} summary={
      <DetailRows rows={[
        { label: "검사 수량", value: formatMetric(scanner?.scanned, "개", 0) },
        { label: "통과 수량", value: scanner ? formatMetric(scanner.scanned - scanner.faults, "개", 0) : undefined },
        { label: "불량 수량", value: formatMetric(scanner?.faults, "개", 0) },
        { label: "통과율", value: formatMetric(passRate, "%"), progress: passRate },
        { label: "최근 결과", value: scanner?.lastResult === "safe" ? "통과" : scanner?.lastResult === "fault" ? "불량" : "검사 대기" },
      ]} />
    } settings={
      <DetailSection title="스캐너 설정">
        <ScannerSettings id={object.id} inputClassName={DETAIL_INPUT_CLASS_NAME} showResults={false} />
        <EquipmentEnabledSetting id={object.id} />
      </DetailSection>
    }>

    </EquipmentDetailLayout>
  );
}
