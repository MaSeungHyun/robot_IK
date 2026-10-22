import { applyEquipmentSettings } from "@/stores/actions/applyEquipmentSettings";
import { SCANNER_CONFIG } from "@/constants/scanner";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import NumberField from "@/components/NumberField";
import { formatDefectRate, scannerResults } from "@/ui/Hud/equipment/scanner/scannerResults";

type Props = { id: string; inputClassName: string; showResults?: boolean };

export default function ScannerSettings({
  id,
  inputClassName,
  showResults = true,
}: Props) {
  const rate = useSceneStore(
    (state) =>
      state.settings[id]?.defectRate ?? SCANNER_CONFIG.defaultDefectRate,
  );
  const snapshot = useSimulationStore((state) =>
    state.equipment?.scanners?.find((scanner) => scanner.id === id),
  );

  return (
    <div className="mt-3">
      <NumberField
        label="불량률"
        unit="%"
        inputClassName={inputClassName}
        min={0}
        max={100}
        value={Number((rate * 100).toFixed(2))}
        onCommit={(value) =>
          applyEquipmentSettings(id, { defectRate: value / 100 })
        }
      />

      {showResults && snapshot && (
        <p className="mt-2 text-xs tabular-nums text-text-secondary">
          {(() => {
            const r = scannerResults(snapshot);
            return `총 ${r.total}개 · OK ${r.ok}개 · NG ${r.ng}개 · 불량률 ${formatDefectRate(r.defectRate)}`;
          })()}
        </p>
      )}
    </div>
  );
}
