import Select from "@/components/Select";
import type { RenderQuality } from "@/constants/viewport";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";

const OPTIONS: readonly { value: RenderQuality; label: string }[] = [
  { value: "performance", label: "성능 우선" },
  { value: "balanced", label: "균형" },
  { value: "high", label: "높음" },
];
const BLOOM_OPTIONS = [
  { value: "on", label: "켜기" },
  { value: "off", label: "끄기" },
] as const;

export default function RenderQualitySelect() {
  const quality = useViewportSettingsStore((state) => state.renderQuality);
  const setQuality = useViewportSettingsStore((state) => state.setRenderQuality);
  const bloom = useViewportSettingsStore((state) => state.bloomEnabled);
  const setBloom = useViewportSettingsStore((state) => state.setBloomEnabled);

  return (
    <>
      <div className="mt-4">
        <p className="mb-2 text-xs text-text-secondary">렌더링 품질</p>
        <Select label="렌더링 품질" value={quality} options={OPTIONS} onValueChange={setQuality} />
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs text-text-secondary">빛 번짐</p>
        <Select label="빛 번짐 (높음: 조명·창, 그 외: AMR)" value={bloom ? "on" : "off"} options={BLOOM_OPTIONS} onValueChange={(value) => setBloom(value === "on")} />
      </div>
    </>
  );
}
