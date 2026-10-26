import { applyToIds, bulkTargets } from "@/stores/actions/applyEquipmentSettings";
import { useSceneStore } from "@/stores/useSceneStore";
import { useShallow } from "zustand/react/shallow";
import { ApplyAllButton } from "@/ui/Hud/object/BulkField";
import type { EquipmentSettings } from "@/types/layout";
import InfoTip from "@/components/InfoTip";
import { TOGGLE_INFO } from "@/ui/Hud/equipment/details/_components/settingInfo";

type BooleanField = { [K in keyof EquipmentSettings]-?: NonNullable<EquipmentSettings[K]> extends boolean ? K : never }[keyof EquipmentSettings];

interface Props {
  id: string;
  field: BooleanField;
  label: string;
  /** Value shown when the setting is absent (legacy scenes). */
  fallback?: boolean;
  info?: React.ReactNode;
}

/** Boolean equipment setting: edits the same-kind multi-selection (one undo step, indeterminate when mixed) and offers "일괄 적용". */
export default function EquipmentToggleSetting({ id, field, label, fallback = false, info }: Props) {
  const ids = useSceneStore(useShallow((state) => bulkTargets(state, id)));
  const value = useSceneStore((state) => state.settings[id]?.[field] ?? fallback);
  const kind = useSceneStore((state) => state.objects.find((o) => o.id === id)?.kind);
  const mixed = useSceneStore((state) => ids.some((target) => (state.settings[target]?.[field] ?? fallback) !== value));

  if (!kind) return null;

  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={value}
          ref={(el) => { if (el) el.indeterminate = mixed; }}
          onChange={(event) => {
            const checked = event.currentTarget.checked;
            applyToIds(ids, () => ({ [field]: checked }));
          }}
        />
        {label}{mixed && " (혼합)"}<InfoTip text={info ?? TOGGLE_INFO[field] ?? label} label={`${label} 설명`} />
      </label>
      <ApplyAllButton kind={kind} patch={() => ({ [field]: value })} />
    </div>
  );
}
