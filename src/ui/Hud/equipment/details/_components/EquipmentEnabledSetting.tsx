import { applyEquipmentSettings } from "@/stores/actions/applyEquipmentSettings";
import { useSceneStore } from "@/stores/useSceneStore";

export default function EquipmentEnabledSetting({ id }: { id: string }) {
  const enabled = useSceneStore((state) => state.settings[id]?.enabled);

  if (enabled === undefined) return null;

  return (
    <label className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) =>
          applyEquipmentSettings(id, { enabled: event.currentTarget.checked })
        }
      />
      작동 활성화
    </label>
  );
}
