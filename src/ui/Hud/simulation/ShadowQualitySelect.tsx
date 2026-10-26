import InfoTip from "@/components/InfoTip";
import Select from "@/components/Select";
import { useViewportSettingsStore, type ShadowQuality } from "@/stores/useViewportSettingsStore";

const OPTIONS: readonly { value: ShadowQuality; label: string }[] = [
  { value: "off", label: "끄기" },
  { value: "low", label: "낮음" },
  { value: "high", label: "높음" },
];

export default function ShadowQualitySelect() {
  const quality = useViewportSettingsStore((state) => state.shadowQuality);
  const setQuality = useViewportSettingsStore((state) => state.setShadowQuality);
  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center text-xs text-text-secondary">그림자 품질<InfoTip label="그림자 품질 설명" text="그림자 해상도입니다. 화면이 느리면 낮음/끄기로 낮추세요. 시뮬레이션 결과에는 영향이 없습니다." /></p>
      <Select label="그림자 품질" value={quality} options={OPTIONS} onValueChange={setQuality} />
    </div>
  );
}
