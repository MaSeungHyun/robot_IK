import Select from "@/components/Select";
import { applyToIds, bulkTargets } from "@/stores/actions/applyEquipmentSettings";
import { useSceneStore } from "@/stores/useSceneStore";
import { useShallow } from "zustand/react/shallow";
import { ApplyAllButton } from "@/ui/Hud/object/BulkField";
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

/** Choice setting; edits the same-kind multi-selection ("혼합" when it differs) and offers "일괄 적용". */
export default function EquipmentChoiceSetting<F extends ChoiceField>({
  id,
  field,
  label,
  fallback,
  options,
}: Props<F>) {
  const ids = useSceneStore(useShallow((state) => bulkTargets(state, id)));
  const kind = useSceneStore((state) => (state.settings[id] ? state.objects.find((o) => o.id === id)?.kind : undefined));
  const values = useSceneStore(useShallow((state) => ids.map((target) => String(state.settings[target]?.[field] ?? fallback))));
  const value = (useSceneStore((state) => state.settings[id]?.[field]) ?? fallback) as NonNullable<EquipmentSettings[F]>;

  if (!kind) return null;
  const mixed = values.some((entry) => entry !== String(value));

  return (
    <div className="mt-2 block text-xs text-text-secondary">
      <p className="mb-1">{label}{mixed && " (혼합)"}</p>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <Select
            label={label}
            value={value}
            options={options}
            onValueChange={(next) =>
              applyToIds(ids, () => ({ [field]: next }) as Partial<EquipmentSettings>)
            }
          />
        </div>
        <ApplyAllButton kind={kind} patch={() => ({ [field]: value }) as Partial<EquipmentSettings>} />
      </div>
    </div>
  );
}