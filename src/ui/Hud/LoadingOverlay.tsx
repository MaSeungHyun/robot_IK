import { useProgress } from "@react-three/drei";
import { LOAD_STAGES, useTemplateLoadStore } from "@/stores/useTemplateLoadStore";
import { useThumbnailStore } from "@/stores/useThumbnailStore";
import { useWarmupStore } from "@/stores/useWarmupStore";

/** Download % (drei useProgress) and the progressive template-load stage. */
export default function LoadingOverlay() {
  const downloading = useProgress((state) => state.active);
  const percent = useProgress((state) => state.progress);
  const loading = useTemplateLoadStore((state) => state.active);
  const stage = useTemplateLoadStore((state) => state.stage);
  // During startup the full-screen StartupOverlay owns the (single) progress bar.
  const warmed = useWarmupStore((state) => state.ready);
  const baked = useThumbnailStore((state) => state.baked);
  if (!warmed || !baked || (!downloading && !loading)) return null;
  const step = downloading ? 0 : Math.max(1, stage);
  const value = downloading ? percent : (step / LOAD_STAGES.length) * 100;
  return (
    <div role="status" className="pointer-events-none absolute right-5 top-5 z-30 w-56 rounded-xl bg-slate-900/90 px-4 py-3 text-sm text-text-primary">
      <p className="flex justify-between gap-2">
        <span>{downloading ? "모델 다운로드 중…" : `${LOAD_STAGES[step]} 배치 중…`}</span>
        <span className="tabular-nums text-text-secondary">{downloading ? `${Math.round(percent)}%` : `${step}/${LOAD_STAGES.length - 1}`}</span>
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded bg-white/10">
        <div className="h-full bg-brand-primary transition-[width] duration-150" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
