import { createContext, useContext } from "react";
import { useSceneStore } from "@/stores/useSceneStore";

/** Settings read only when Play starts (roles, layout type) are locked while playing. */
export function usePlayLocked() {
  return useSceneStore((state) => !state.editing);
}

/** Renders only the settings (+ cycle state) of a details view; used by the editor properties panel. */
export const SettingsOnlyContext = createContext(false);
export const useSettingsOnly = () => useContext(SettingsOnlyContext);
