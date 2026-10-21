import { applyEquipmentSettings } from "@/stores/actions/applyEquipmentSettings";
import { useModeStore } from "@/stores/useModeStore";
import { DETAIL_INPUT_CLASS_NAME } from "@/ui/Hud/equipment/details/styles";
import { useSceneStore } from "@/stores/useSceneStore";
import NumberField from "@/components/NumberField";
import {
  amrSpeedOf, beltSpeedOf, fromBoxesPerHour, fromMetersPerMinute, spawnIntervalOf, speedPatch,
  toBoxesPerHour, toMetersPerMinute,
} from "@/domain/simulation/equipmentSpeeds";
import type { EquipmentSettings } from "@/types/layout";

type Field = "speed" | "reach" | "capacity" | "spawnInterval" | "beltSpeed" | "amrSpeed";
type Props = {
  id: string;
  field: Field;
  label: string;
  unit?: string;
  min: number;
  max?: number;
  exclusiveMin?: boolean;
  integer?: boolean;
  /** Kept for call-site compatibility; free typing ignores steps. */
  step?: number;
};

function read(field: Field, config: EquipmentSettings) {
  // Display units: belt m/min, box feed boxes/h (stored as m/s and seconds).
  if (field === "beltSpeed") return toMetersPerMinute(beltSpeedOf(config));
  if (field === "amrSpeed") return amrSpeedOf(config);
  if (field === "spawnInterval") return toBoxesPerHour(spawnIntervalOf(config));
  return config[field];
}

export default function EquipmentNumberSetting({ id, field, label, unit, min, max, exclusiveMin, integer = false }: Props) {
  const config = useSceneStore((state) => state.settings[id]);
  const readOnly = useModeStore((state) => state.mode !== "simulation");

  if (!config) return null;

  return (
    <NumberField
      label={label}
      unit={unit}
      value={read(field, config)}
      min={min}
      max={max}
      exclusiveMin={exclusiveMin}
      integer={integer}
      decimals={2}
      disabled={readOnly}
      inputClassName={DETAIL_INPUT_CLASS_NAME}
      onCommit={(value) =>
        applyEquipmentSettings(
          id,
          field === "beltSpeed"
            ? speedPatch(field, fromMetersPerMinute(value), config)
            : field === "spawnInterval"
              ? speedPatch(field, fromBoxesPerHour(value), config)
              : field === "amrSpeed"
                ? speedPatch(field, value, config)
            : { [field]: value },
        )
      }
    />
  );
}
