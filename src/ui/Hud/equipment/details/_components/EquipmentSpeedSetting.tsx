import EquipmentNumberSetting from "@/ui/Hud/equipment/details/_components/EquipmentNumberSetting";
import { useSceneStore } from "@/stores/useSceneStore";

type Props = { id: string; connected?: boolean };

export default function EquipmentSpeedSetting({
  id,
  connected = false,
}: Props) {
  const speed = useSceneStore((state) => state.settings[id]?.speed);

  if (speed === undefined) return null;

  return (
    <div>
      <EquipmentNumberSetting
        id={id}
        field="speed"
        label={connected ? "연결 컨베이어 속도 ×" : "작동 속도 ×"}
        min={0.25}
        max={3}
        step={0.25}
      />
    </div>
  );
}
