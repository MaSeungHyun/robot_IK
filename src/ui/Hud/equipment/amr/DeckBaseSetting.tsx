import Select from "@/components/Select";
import InfoTip from "@/components/InfoTip";
import { useSceneStore } from "@/stores/useSceneStore";
import { applyToIds } from "@/stores/actions/applyEquipmentSettings";
import { PLAY_LOCK_TEXT, usePlayLocked } from "@/ui/Hud/equipment/details/_components/playLockState";

type Base = "pallet" | "none";
const OPTIONS: readonly { value: Base; label: string }[] = [
  { value: "pallet", label: "팔레트" },
  { value: "none", label: "팔레트 없음" },
];

/**
 * 기본: what a pallet/shuttle AMR starts with. 팔레트 = shuttle with a mounted empty pallet (robots load onto it, no
 * forklift needed). 팔레트 없음 = empty top: a forklift supplies one (shuttle) or it receives one at a pallet infeed
 * (pallet AMR). A shuttle keeps its pallet object as the station anchor and only flips `initialPallet`.
 */
export default function DeckBaseSetting({ id }: { id: string }) {
  const role = useSceneStore((state) => state.settings[id]?.amrRole ?? "pallet");
  const initial = useSceneStore((state) => state.settings[id]?.initialPallet);
  const carried = useSceneStore((state) => state.objects.some((o) => o.kind === "pallet" && state.settings[o.id]?.mountedOn === id));
  const locked = usePlayLocked();
  if (role !== "pallet" && role !== "shuttle") return null;
  const value: Base = role === "shuttle" && carried && initial !== "forklift" ? "pallet" : "none";

  const choose = (next: Base) => {
    const store = useSceneStore.getState();
    if (next === "pallet") {
      if (!carried) store.setCarriedPallet(id, true);
      applyToIds([id], () => ({ amrRole: "shuttle", initialPallet: "mounted" }));
    } else if (role === "shuttle") {
      applyToIds([id], () => ({ initialPallet: "forklift" }));
    } else if (carried) {
      store.setCarriedPallet(id, false);
    }
  };

  return (
    <fieldset disabled={locked} className="mt-2 block min-w-0 text-xs text-text-secondary">
      <p className="mb-1 flex items-center">기본<InfoTip label="기본 설명" text={<>
        팔레트: 빈 팔레트를 실은 채 시작합니다. 로봇이 이 팔레트에 바로 적재하므로 지게차 없이 테스트할 때 사용합니다(셔틀 AMR로 전환).<br />
        팔레트 없음: 빈 상단으로 시작합니다. 지게차가 적치장에서 팔레트를 올려 주거나, 입하 팔레트 컨베이어 끝에서 팔레트를 받습니다. 팔레트가 저절로 생기지는 않습니다.
        {locked && <><br />{PLAY_LOCK_TEXT}</>}
      </>} /></p>
      <div className={locked ? "opacity-40" : undefined}>
        <Select label="기본" value={value} options={OPTIONS} disabled={locked} onValueChange={choose} />
      </div>
    </fieldset>
  );
}