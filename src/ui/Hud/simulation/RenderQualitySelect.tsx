import InfoTip from "@/components/InfoTip";
import Select from "@/components/Select";
import type { RenderQuality } from "@/constants/viewport";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";

const OPTIONS: readonly { value: RenderQuality; label: string }[] = [
  { value: "performance", label: "성능 우선" },
  { value: "balanced", label: "균형" },
  { value: "high", label: "높음" },
];
const RENDERER_OPTIONS = [
  { value: "webgl", label: "WebGL (기본)" },
  { value: "webgpu", label: "WebGPU" },
] as const;
const BLOOM_OPTIONS = [
  { value: "on", label: "켜기" },
  { value: "off", label: "끄기" },
] as const;

export default function RenderQualitySelect() {
  const quality = useViewportSettingsStore((state) => state.renderQuality);
  const setQuality = useViewportSettingsStore((state) => state.setRenderQuality);
  const bloom = useViewportSettingsStore((state) => state.bloomEnabled);
  const setBloom = useViewportSettingsStore((state) => state.setBloomEnabled);
  const webgpu = useViewportSettingsStore((state) => state.webgpu);
  const setWebGPU = useViewportSettingsStore((state) => state.setWebGPU);
  const activeRenderer = useViewportSettingsStore((state) => state.activeRenderer);
  const notice = useViewportSettingsStore((state) => state.rendererNotice);
  const onWebGPU = activeRenderer === "webgpu";

  return (
    <>
      <div className="mt-4">
        <p className="mb-2 flex items-center text-xs text-text-secondary">렌더링 품질<InfoTip label="렌더링 품질 설명" text="해상도·후처리 수준입니다. 대형 레이아웃이나 저사양 PC는 성능 우선을 쓰세요." /></p>
        <Select label="렌더링 품질" value={quality} options={OPTIONS} onValueChange={setQuality} />
      </div>
      <div className="mt-4">
        <p className="mb-2 flex items-center text-xs text-text-secondary">렌더러<InfoTip label="렌더러 설명" text="WebGL은 호환성이 높은 기본값, WebGPU는 지원 브라우저에서 대형 씬이 더 빠를 수 있습니다." /></p>
        <Select label="렌더러" value={webgpu ? "webgpu" : "webgl"} options={RENDERER_OPTIONS} onValueChange={(value) => setWebGPU(value === "webgpu")} />
        <p className="mt-1 text-[11px] text-text-secondary">
          현재: {activeRenderer === null ? "초기화 중" : onWebGPU ? "WebGPU" : "WebGL"}
        </p>
        {notice && <p className="mt-1 text-[11px] text-text-secondary">{notice}</p>}
      </div>
      <div className="mt-4">
        <p className="mb-2 flex items-center text-xs text-text-secondary">AMR 빛 번짐<InfoTip label="AMR 빛 번짐 설명" text="AMR 상태등의 빛 번짐(블룸) 효과입니다. 성능이 부족하면 끄세요." /></p>
        <Select label="AMR 빛 번짐" value={bloom && !onWebGPU ? "on" : "off"} options={BLOOM_OPTIONS} disabled={onWebGPU} onValueChange={(value) => setBloom(value === "on")} />
        {onWebGPU && <p className="mt-1 text-[11px] text-text-secondary">WebGPU에서는 지원되지 않음</p>}
      </div>
    </>
  );
}
