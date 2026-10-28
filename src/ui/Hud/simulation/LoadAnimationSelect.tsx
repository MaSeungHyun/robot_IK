import InfoTip from "@/components/InfoTip";
import Select from "@/components/Select";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";

const OPTIONS: readonly { value: "on" | "off"; label: string }[] = [
  { value: "on", label: "켜기" },
  { value: "off", label: "끄기" },
];

export default function LoadAnimationSelect() {
  const enabled = useViewportSettingsStore((state) => state.loadAnimation);
  const setEnabled = useViewportSettingsStore((state) => state.setLoadAnimation);
  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center text-xs text-text-secondary">로딩 애니메이션<InfoTip label="로딩 애니메이션 설명" text="템플릿을 불러올 때 구조물 → 컨베이어 → 설비 → 랙 → 팔레트 순서로 나눠서 드롭인 효과와 함께 보여줍니다. 끄면 효과 없이 바로 나타납니다(구성은 똑같이 프레임 단위로 나눠 처리). 로딩이 끝날 때까지 실행은 잠깁니다." /></p>
      <Select label="로딩 애니메이션" value={enabled ? "on" : "off"} options={OPTIONS} onValueChange={(value) => setEnabled(value === "on")} />
    </div>
  );
}
