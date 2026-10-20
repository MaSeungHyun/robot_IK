import { applyEquipmentSettings } from "@/utils/equipment/applyEquipmentSettings";
import { useModeStore } from "@/stores/useModeStore";
import Badge from "@/components/Badge";
import { SCANNER_CONFIG } from "@/constants/scanner";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";

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
  const readOnly = useModeStore((state) => state.mode !== "simulation");
  const snapshot = useSimulationStore((state) =>
    state.equipment?.scanners?.find((scanner) => scanner.id === id),
  );

  return (
    <div className="mt-3">
      <label className="block text-xs text-text-secondary">
        불량률 %
        <input
          disabled={readOnly}
          aria-label="불량률"
          className={inputClassName}
          type="number"
          min={0}
          max={100}
          step={1}
          value={Number((rate * 100).toFixed(2))}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value) && value >= 0 && value <= 100) {
              applyEquipmentSettings(id, { defectRate: value / 100 });
            }
          }}
        />
      </label>

      <p className="mt-2 text-xs text-text-secondary">
        ScanPoint를 지난 박스를 랜덤 판정합니다. 표시 시간은 1초입니다.
      </p>

      {showResults && snapshot && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-text-secondary">
            검사 {snapshot.scanned}개 · 통과{" "}
            {snapshot.scanned - snapshot.faults}개 · 불량 {snapshot.faults}개
          </p>
          <Badge tone={snapshot.lastResult ?? "idle"}>
            {snapshot.lastResult === "safe"
              ? "통과"
              : snapshot.lastResult === "fault"
                ? "불량"
                : "검사 대기"}
          </Badge>
        </div>
      )}
    </div>
  );
}
