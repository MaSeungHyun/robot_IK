import { applyToIds, bulkTargets } from "@/stores/actions/applyEquipmentSettings";
import { useSceneStore } from "@/stores/useSceneStore";
import { useShallow } from "zustand/react/shallow";
import { ApplyAllButton } from "@/ui/Hud/object/BulkField";
import InfoTip from "@/components/InfoTip";
import { TOGGLE_INFO } from "@/ui/Hud/equipment/details/_components/settingInfo";

/** 작동 활성화: edits the same-kind multi-selection (indeterminate when mixed) and offers "일괄 적용". */
export default function EquipmentEnabledSetting({ id }: { id: string }) {
  const ids = useSceneStore(useShallow((state) => bulkTargets(state, id)));
  const enabled = useSceneStore((state) => state.settings[id]?.enabled);
  const kind = useSceneStore((state) => state.objects.find((o) => o.id === id)?.kind);
  const mixed = useSceneStore((state) => ids.some((target) => state.settings[target]?.enabled !== enabled));

  if (enabled === undefined || !kind) return null;

  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={enabled}
          ref={(el) => { if (el) el.indeterminate = mixed; }}
          onChange={(event) => {
            const checked = event.currentTarget.checked;
            applyToIds(ids, () => ({ enabled: checked }));
          }}
        />
        작동 활성화{mixed && " (혼합)"}<InfoTip text={TOGGLE_INFO.enabled} label="작동 활성화 설명" />
      </label>
      <ApplyAllButton kind={kind} patch={() => ({ enabled })} />
    </div>
  );
}