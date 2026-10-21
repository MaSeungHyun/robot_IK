import Button from "@/components/Button";
import Icon from "@/components/Icon";
import { useCameraTrackingStore } from "@/stores/useCameraTrackingStore";
import { useSceneStore } from "@/stores/useSceneStore";

export default function TrackingIndicator() {
  const trackedId = useCameraTrackingStore((state) => state.trackedId);
  const release = useCameraTrackingStore((state) => state.track);
  const name = useSceneStore(
    (state) => state.objects.find((object) => object.id === trackedId)?.name,
  );
  if (!trackedId) return null;

  return (
    <div className="pointer-events-auto absolute bottom-5 left-1/2 z-10 flex max-w-full -translate-x-1/2 items-center gap-3 rounded-full border border-brand-primary/50 bg-bg-primary/90 py-1.5 pr-2 pl-4 text-xs text-cyan-200 shadow-[0_0_20px_#22d3ee20] backdrop-blur-md">
      <Icon icon="LocateFixed" className="size-4 shrink-0" />
      <span className="truncate">{name ?? trackedId} · 추적 중</span>
      <Button
        type="button"
        aria-label="카메라 추적 해제"
        onClick={() => release(null)}
        className="h-6 shrink-0 rounded-full px-2 text-[10px]"
      >
        해제
      </Button>
    </div>
  );
}
