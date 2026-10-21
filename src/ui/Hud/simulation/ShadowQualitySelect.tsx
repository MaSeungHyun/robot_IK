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
      <p className="mb-2 text-xs text-text-secondary">그림자 품질</p>
      <Select label="그림자 품질" value={quality} options={OPTIONS} onValueChange={setQuality} />
    </div>
  );
}
