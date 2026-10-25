import { createContext, useContext } from "react";
import { useSceneStore } from "@/stores/useSceneStore";

export const PLAY_LOCK_TEXT = "Play 중에는 잠겨 있습니다 · 정지 후 변경 가능";

/** Settings read only when Play starts (roles, layout type) are locked while playing. */
export function usePlayLocked() {
  return useSceneStore((state) => !state.editing);
}

/** Renders only the settings (+ cycle state) of a details view; used by the editor properties panel. */
export const SettingsOnlyContext = createContext(false);
export const useSettingsOnly = () => useContext(SettingsOnlyContext);
