import Button from "@/components/Button";
import NumberField from "@/components/NumberField";
import { DOOR_CONFIG } from "@/constants/door";
import { applyEquipmentSettings } from "@/stores/actions/applyEquipmentSettings";
import { useSceneStore } from "@/stores/useSceneStore";

/** Open/close toggle (edit and play; the saved state is also the door's initial state) and opening size. */
export default function DoorSettings({ id, inputClassName }: { id: string; inputClassName: string }) {
  const config = useSceneStore((state) => state.settings[id]);
  if (!config) return null;
  const open = config.doorOpen === true;
  return (
    <div className="mt-3 space-y-3">
      <Button type="button" fill className="w-full" aria-pressed={open} onClick={() => applyEquipmentSettings(id, { doorOpen: !open })}>
        {open ? "닫기" : "열기"}
      </Button>
      <p className="text-[11px] text-text-secondary">현재 상태: {open ? "열림" : "닫힘"} · 저장 시 이 상태로 시작합니다.</p>
      <NumberField label="폭" unit="m" decimals={2} min={DOOR_CONFIG.minSize} max={DOOR_CONFIG.maxWidth}
        value={config.doorWidth ?? DOOR_CONFIG.width} inputClassName={inputClassName}
        onCommit={(value) => applyEquipmentSettings(id, { doorWidth: value })} />
      <NumberField label="높이" unit="m" decimals={2} min={DOOR_CONFIG.minSize} max={DOOR_CONFIG.maxHeight}
        value={config.doorHeight ?? DOOR_CONFIG.height} inputClassName={inputClassName}
        onCommit={(value) => applyEquipmentSettings(id, { doorHeight: value })} />
    </div>
  );
}