import { formatMetric } from "@/utils/equipment/formatMetric";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import Badge from "@/components/Badge";
import EquipmentDetailLayout from "@/ui/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import EquipmentEnabledSetting from "@/ui/Hud/equipment/details/_components/EquipmentEnabledSetting";
import { DETAIL_INPUT_CLASS_NAME } from "@/ui/Hud/equipment/details/styles";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import ScannerSettings from "@/ui/Hud/equipment/scanner/ScannerSettings";
import { formatDefectRate, scannerResults } from "@/ui/Hud/equipment/scanner/scannerResults";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";

export default function ScannerDetails({ object }: EquipmentDetailProps) {
  const scanner = useSimulationStore((state) =>
    state.equipment?.scanners?.find((scanner) => scanner.id === object.id),
  );
  const running = useSimulationStore((state) => state.running);
  const enabled = useSceneStore((state) => state.settings[object.id]?.enabled) !== false;
  const { total, ok, ng, defectRate } = scannerResults(scanner);

  // Equipment state only (not the last box's result): results are the cumulative counts below.
  const status = (
    <Badge tone={!enabled ? "offline" : running ? "operating" : "idle"}>
      {!enabled ? "중지" : running ? "검사 중" : "대기"}
    </Badge>
  );

  return (
    <EquipmentDetailLayout
      object={object}
      status={status}
      summary={
        <DetailRows
          rows={[
            { label: "총 통과", value: formatMetric(total, "개", 0) },
            { label: "OK (통과)", value: formatMetric(ok, "개", 0) },
            {
              label: "NG (불량)",
              value: <span className={ng > 0 ? "text-fault" : undefined}>{formatMetric(ng, "개", 0)}</span>,
            },
            { label: "불량률", value: formatDefectRate(defectRate) },
          ]}
        />
      }
      settings={
        <DetailSection title="스캐너 설정">
          <ScannerSettings
            id={object.id}
            inputClassName={DETAIL_INPUT_CLASS_NAME}
            showResults={false}
          />
          <EquipmentEnabledSetting id={object.id} />
        </DetailSection>
      }
    ></EquipmentDetailLayout>
  );
}
