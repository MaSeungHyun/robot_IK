import Select from "@/components/Select";
import { applyToIds, bulkTargets } from "@/stores/actions/applyEquipmentSettings";
import { useSceneStore } from "@/stores/useSceneStore";
import { useShallow } from "zustand/react/shallow";
import { ApplyAllButton } from "@/ui/Hud/object/BulkField";
import { amrModelOf, type EquipmentSettings } from "@/types/layout";
import InfoTip from "@/components/InfoTip";
import { PLAY_LOCK_TEXT, usePlayLocked } from "@/ui/Hud/equipment/details/_components/playLockState";
import { CHOICE_INFO } from "@/ui/Hud/equipment/details/_components/settingInfo";

type ChoiceField = "pickFilter" | "grade" | "acceptGrade" | "conveyorRole" | "dockRole" | "robotRole" | "inboundUnit" | "amrRole" | "forkliftTask" | "forkliftRole" | "emptyPallet" | "rackType" | "initialPallet";

/** Read when Play starts (simulator construction): changing them mid-run would desync the run. */
const PLAY_LOCKED: ReadonlySet<ChoiceField> = new Set(["conveyorRole", "dockRole", "robotRole", "inboundUnit", "amrRole", "forkliftTask", "forkliftRole", "emptyPallet", "rackType", "initialPallet"]);

type Props<F extends ChoiceField> = {
  id: string;
  field: F;
  label: string;
  /** Used when the setting is absent (older scenes and templates). */
  fallback: NonNullable<EquipmentSettings[F]>;
  options: readonly { value: NonNullable<EquipmentSettings[F]>; label: string }[];
  /** Explanation behind the (i) icon next to the label. */
  info?: React.ReactNode;
};

/** Choice setting; edits the same-kind multi-selection ("혼합" when it differs) and offers "일괄 적용". */
export default function EquipmentChoiceSetting<F extends ChoiceField>({
  id,
  field,
  label,
  fallback,
  options,
  info,
}: Props<F>) {
  // amrRole: never apply across model families (a role change must not swap an AMR's model).
  const ids = useSceneStore(useShallow((state) => {
    const targets = bulkTargets(state, id);
    if (field !== "amrRole") return targets;
    const model = amrModelOf(state.settings[id]?.amrRole);
    return targets.filter((target) => amrModelOf(state.settings[target]?.amrRole) === model);
  }));
  const kind = useSceneStore((state) => (state.settings[id] ? state.objects.find((o) => o.id === id)?.kind : undefined));
  const values = useSceneStore(useShallow((state) => ids.map((target) => String(state.settings[target]?.[field] ?? fallback))));
  const value = (useSceneStore((state) => state.settings[id]?.[field]) ?? fallback) as NonNullable<EquipmentSettings[F]>;

  const playLocked = usePlayLocked();
  if (!kind) return null;
  const locked = playLocked && PLAY_LOCKED.has(field);
  const mixed = values.some((entry) => entry !== String(value));

  return (
    <fieldset disabled={locked} className="mt-2 block min-w-0 text-xs text-text-secondary">
      <p className="mb-1 flex items-center">{label}{mixed && " (혼합)"}<InfoTip text={<>{CHOICE_INFO[field]}{info && <><br />{info}</>}{locked && <><br />{PLAY_LOCK_TEXT}</>}</>} label={`${label} 설명`} /></p>
      <div className={`flex items-center gap-1${locked ? " opacity-40" : ""}`}>
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
        {field !== "amrRole" && <ApplyAllButton kind={kind} patch={() => ({ [field]: value }) as Partial<EquipmentSettings>} />}
      </div>
    </fieldset>
  );
}