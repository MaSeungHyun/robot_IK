import { SCANNER_CONFIG } from "@/constants/scanner";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { BulkNumber } from "@/ui/Hud/object/BulkField";
import { formatDefectRate, scannerResults } from "@/ui/Hud/equipment/scanner/scannerResults";

/** `ids`: multi-edit targets (default just `id`; the primary should be last). */
type Props = { id: string; ids?: string[]; inputClassName: string; showResults?: boolean };

export default function ScannerSettings({
  id,
  ids,
  inputClassName,
  showResults = true,
}: Props) {
  const snapshot = useSimulationStore((state) =>
    state.equipment?.scanners?.find((scanner) => scanner.id === id),
  );

  return (
    <div className="mt-3">
      <BulkNumber
        ids={ids ?? [id]}
        kind="scanner"
        label="불량률"
        unit="%"
        inputClassName={inputClassName}
        min={0}
        max={100}
        read={(config) => Number(((config.defectRate ?? SCANNER_CONFIG.defaultDefectRate) * 100).toFixed(2))}
        write={(value) => ({ defectRate: value / 100 })}
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
