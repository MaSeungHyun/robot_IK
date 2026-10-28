import { create } from "zustand";
import type { StopRole } from "@/types/layout";

/** Floor-click placing mode: the equipment whose next floor click adds a 셔틀 구역 (role null) or a stop point (role set). */
export const useShuttleZoneStore = create<{ placingFor: string | null; placingRole: StopRole | null; setPlacingFor: (id: string | null, role?: StopRole | null) => void }>((set) => ({
  placingFor: null,
  placingRole: null,
  setPlacingFor: (placingFor, role = null) => set({ placingFor, placingRole: placingFor ? role : null }),
}));