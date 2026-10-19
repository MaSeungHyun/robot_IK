import { applyEquipmentSettings } from "@/utils/equipment/applyEquipmentSettings";
import { useModeStore } from "@/stores/useModeStore";
import { DETAIL_INPUT_CLASS_NAME } from "@/features/Hud/equipment/details/styles";
import { useSceneStore } from "@/stores/useSceneStore";

type Props = {
  id: string;
  field: "speed" | "reach" | "capacity" | "spawnInterval";
  label: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
};

export default function EquipmentNumberSetting({ id, field, label, min, max, step, integer = false }: Props) {
  const value = useSceneStore((state) => state.settings[id]?.[field]);
  const readOnly = useModeStore((state) => state.mode !== "simulation");

  if (value === undefined) return null;

  return (
    <label className="block text-xs text-text-secondary">
      {label}
      <input disabled={readOnly}
        aria-label={label}
        className={DETAIL_INPUT_CLASS_NAME}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next) && next >= min && next <= max && (!integer || Number.isInteger(next))) {
            applyEquipmentSettings(id, { [field]: next });
          }
        }}
      />
    </label>
  );
}
