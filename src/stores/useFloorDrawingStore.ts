import { create } from "zustand";
import type { FloorSize } from "@/types/layout";

type FloorDrawing = FloorSize & { phase: "drag" | "height" };
type FloorDrawingState = {
  drawing: FloorDrawing | null;
  setDrawing: (drawing: FloorDrawing | null) => void;
};

/** Transient editor feedback, separate from scene objects and undo history. */
export const useFloorDrawingStore = create<FloorDrawingState>((set) => ({
  drawing: null,
  setDrawing: (drawing) => set((state) => {
    const previous = state.drawing;
    if (previous === drawing || (previous && drawing &&
      previous.phase === drawing.phase && previous.width === drawing.width &&
      previous.depth === drawing.depth && previous.wallHeight === drawing.wallHeight)) return state;
    return { drawing };
  }),
}));
