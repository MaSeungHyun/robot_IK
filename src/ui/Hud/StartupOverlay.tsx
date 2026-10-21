import { useProgress } from "@react-three/drei";
import { useThumbnailStore } from "@/stores/useThumbnailStore";
import { useWarmupStore } from "@/stores/useWarmupStore";

/** Blocks the app until models are loaded, shaders are compiled and thumbnails are baked. */
export default function StartupOverlay() {
  const progress = useProgress((state) => state.progress);
  const warmed = useWarmupStore((state) => state.ready);
  const baked = useThumbnailStore((state) => state.baked);
  if (warmed && baked) return null;
  const loading = progress < 100;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto absolute inset-0 z-500 flex items-center justify-center bg-bg-primary/90 backdrop-blur-sm"
    >
      <div className="flex w-64 flex-col gap-3 rounded-md border border-brand-primary/20 bg-bg-primary/95 p-4 text-text-primary shadow-2xl">
        <p className="text-sm font-semibold tracking-wider">SMART FACTORY</p>
        <p className="text-xs text-text-secondary">
          {loading ? "모델 불러오는 중…" : "장비 준비 중…"}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-brand-primary transition-[width] duration-200"
            style={{ width: `${loading ? Math.round(progress * 0.8) : 90}%` }}
          />
        </div>
      </div>
    </div>
  );
}
