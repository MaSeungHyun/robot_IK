import { cn } from "@/lib/style";
import { useCameraTrackingStore } from "@/stores/useCameraTrackingStore";

export default function TrackingOverlay() {
  const tracking = useCameraTrackingStore((state) => state.trackedId !== null);
  // const id = useCameraTrackingStore((state) => state.trackedId);
  // const object = useSceneStore((state) =>
  //   state.objects.find((object) => object.id === id),
  // );
  return (
    <div className="pointer-events-none absolute inset-0 z-2 ">
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0",
          tracking &&
            "motion-safe:animate-[tracking-pulese_2.0s_linear_infinite] border-2 border-tracking-indicator/10",
        )}
        style={{
          boxShadow: tracking
            ? "inset 0 0 80px var(--color-tracking-pulse)"
            : undefined,
        }}
      >
        {/* {tracking && (
          <div className="pointer-events-none absolute inset-0 z-20 w-full font-bold text-2xl h-full flex items-center justify-center bg-blue-500/10">
            <div className="flex items-center justify-center border-4 border-tracking-indicator rounded-md min-w-128 min-h-32 text-tracking-indicator animate-[tracking-text-pulse_2.0s_linear_infinite]">
              <div className="text-4xl font-bold">{object?.name} 추적 중</div>
            </div>
          </div>
        )} */}
      </div>
      {tracking && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden border border-blue-400/65 text-blue-300 shadow-[inset_0_0_18px_#06bff40,0_0_10px_#06b6ff40]"
        >
          <div className="absolute inset-y-0 left-0 w-24 bg-linear-to-r from-blue-500/12 to-transparent" />
          <div className="absolute inset-y-0 right-0 w-24 bg-linear-to-l from-blue-500/12 to-transparent" />
          <div className="absolute inset-x-0 top-0 h-10 bg-linear-to-b from-blue-500/10 to-transparent" />
          <span className="absolute top-2 left-2 size-5 border-t border-l border-blue-500/70" />
          <span className="absolute top-2 right-2 size-5 border-t border-r border-blue-500/70" />
          <span className="absolute bottom-2 left-2 size-5 border-b border-l border-blue-500/70" />
          <span className="absolute right-2 bottom-2 size-5 border-r border-b border-blue-500/70" />
        </div>
      )}
    </div>
  );
}
