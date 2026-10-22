import Button from "@/components/Button";
import { ApplyAllButton, BulkNumber } from "@/ui/Hud/object/BulkField";
import { applyToIds } from "@/stores/actions/applyEquipmentSettings";
import { DOOR_CONFIG } from "@/constants/door";
import { useSceneStore } from "@/stores/useSceneStore";

/** Open/close toggle (edit and play; the saved state is also the door's initial state) and opening size. */
export default function DoorSettings({
  id,
  ids,
  inputClassName,
}: {
  id: string;
  /** Multi-edit targets (primary last). */ ids?: string[];
  inputClassName: string;
}) {
  const targets = ids ?? [id];
  const config = useSceneStore((state) => state.settings[id]);
  if (!config) return null;
  const open = config.doorOpen === true;
  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          fill
          className="min-w-0 flex-1"
          aria-pressed={open}
          onClick={() => applyToIds(targets, () => ({ doorOpen: !open }))}
        >
          {open ? "닫기" : "열기"}
        </Button>
      </div>
      <ApplyAllButton
        className="w-full"
        kind="door"
        patch={() => ({ doorOpen: open })}
      />

      <BulkNumber
        ids={targets}
        kind="door"
        label="폭"
        unit="m"
        decimals={2}
        min={DOOR_CONFIG.minSize}
        max={DOOR_CONFIG.maxWidth}
        inputClassName={inputClassName}
        read={(c) => c.doorWidth ?? DOOR_CONFIG.width}
        write={(value) => ({ doorWidth: value })}
      />
      <BulkNumber
        ids={targets}
        kind="door"
        label="높이"
        unit="m"
        decimals={2}
        min={DOOR_CONFIG.minSize}
        max={DOOR_CONFIG.maxHeight}
        inputClassName={inputClassName}
        read={(c) => c.doorHeight ?? DOOR_CONFIG.height}
        write={(value) => ({ doorHeight: value })}
      />
    </div>
  );
}
