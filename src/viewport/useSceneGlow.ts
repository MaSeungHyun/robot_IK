import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";

/** True when the "high" tier scene bloom is on: light surfaces then render HDR (toneMapped off, gain > 1). */
export default function useSceneGlow() {
  return useViewportSettingsStore((state) => state.renderQuality === "high" && state.bloomEnabled);
}
