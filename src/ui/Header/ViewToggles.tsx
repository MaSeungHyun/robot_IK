import IconButton from "@/components/IconButton";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";

/** Header toggles for viewport overlays: minimap, and (dev builds only) the perf meter. */
export default function ViewToggles() {
  const minimap = useViewportSettingsStore((state) => state.minimap);
  const perf = useViewportSettingsStore((state) => state.perfOverlay);
  return (
    <>
      <IconButton
        icon="Map"
        label="미니맵"
        active={minimap}
        aria-pressed={minimap}
        onClick={() => useViewportSettingsStore.getState().toggleMinimap()}
      />
      {import.meta.env.DEV && (
        <IconButton
          icon="Gauge"
          label="성능 측정 (Shift+P)"
          active={perf}
          aria-pressed={perf}
          onClick={() => useViewportSettingsStore.getState().togglePerfOverlay()}
        />
      )}
    </>
  );
}
