import Select from "@/components/Select";
import { applyEquipmentSettings } from "@/stores/actions/applyEquipmentSettings";
import { useSceneStore } from "@/stores/useSceneStore";
import type { EquipmentSettings } from "@/types/layout";

type ChoiceField = "pickFilter" | "grade" | "acceptGrade";

type Props<F extends ChoiceField> = {
  id: string;
  field: F;
  label: string;
  /** Used when the setting is absent (older scenes and templates). */
  fallback: NonNullable<EquipmentSettings[F]>;
  options: readonly { value: NonNullable<EquipmentSettings[F]>; label: string }[];
};

export default function EquipmentChoiceSetting<F extends ChoiceField>({
  id,
  field,
  label,
  fallback,
  options,
}: Props<F>) {
  const exists = useSceneStore((state) => state.settings[id] !== undefined);
  const value = useSceneStore((state) => state.settings[id]?.[field]) ?? fallback;

  if (!exists) return null;

  return (
    <div className="mt-2 block text-xs text-text-secondary">
      <p className="mb-1">{label}</p>
      <Select
          label={label}
          value={value}
          options={options}
          onValueChange={(next) =>
            applyEquipmentSettings(id, { [field]: next } as Partial<EquipmentSettings>)
          }
        />
    </div>
  );
}
