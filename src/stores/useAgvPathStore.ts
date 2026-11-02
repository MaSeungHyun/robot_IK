import { create } from "zustand";

/** AGV 경로 추가 mode: the AGV whose floor clicks append waypoints to its settings.agvPath (null = off). */
export const useAgvPathStore = create<{ drawingFor: string | null; setDrawingFor: (id: string | null) => void }>((set) => ({
  drawingFor: null,
  setDrawingFor: (drawingFor) => set({ drawingFor }),
}));
