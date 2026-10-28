import { create } from "zustand";

/** 셔틀 구역 지정 mode: the pallet-inbound conveyor whose next floor click adds a shuttle zone. */
export const useShuttleZoneStore = create<{ placingFor: string | null; setPlacingFor: (id: string | null) => void }>((set) => ({
  placingFor: null,
  setPlacingFor: (placingFor) => set({ placingFor }),
}));
