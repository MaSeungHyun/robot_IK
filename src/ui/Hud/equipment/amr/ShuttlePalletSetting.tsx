import { useSceneStore } from "@/stores/useSceneStore";
import InfoTip from "@/components/InfoTip";
import { PLAY_LOCK_TEXT } from "@/ui/Hud/equipment/details/_components/playLockState";

/** 팔레트 포함: a shuttle AMR's deck pallet (mounted, follows the AMR); editable only while editing (locked with a hint in Play), one undo step. */
export default function ShuttlePalletSetting({ id }: { id: string }) {
  const shuttle = useSceneStore((state) => state.settings[id]?.amrRole === "shuttle");
  const editing = useSceneStore((state) => state.editing);
  const carried = useSceneStore((state) => state.objects.some((o) => o.kind === "pallet" && state.settings[o.id]?.mountedOn === id));

  if (!shuttle) return null;

  return (
    <div className="mt-2">
    <div className="flex items-center justify-between gap-2">
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={carried}
          disabled={!editing}
          onChange={(event) => useSceneStore.getState().setCarriedPallet(id, event.currentTarget.checked)}
        />
        팔레트 포함
      </label>
      <InfoTip label="팔레트 포함 설명" text={<>AMR 위에 실린 팔레트는 AMR을 따라 움직입니다. 팔레트를 AMR 위에 놓아도 연결됩니다.{!editing && <><br />{PLAY_LOCK_TEXT}</>}</>} />
    </div>
    </div>
  );
}
