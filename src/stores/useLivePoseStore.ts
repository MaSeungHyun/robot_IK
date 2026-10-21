import { create } from "zustand";

/** Uncommitted robot positions while dragging (G-move / gizmo), so range overlaps update live. */
export const useLivePoseStore = create<{
  poses: Record<string, { x: number; z: number }>;
  set: (id: string, x: number, z: number) => void;
  clear: (id: string) => void;
}>((set) => ({
  poses: {},
  set: (id, x, z) =>
    set((state) => {
      const current = state.poses[id];
      return current && current.x === x && current.z === z ? {} : { poses: { ...state.poses, [id]: { x, z } } };
    }),
  clear: (id) =>
    set((state) => {
      if (!(id in state.poses)) return {};
      const poses = { ...state.poses };
      delete poses[id];
      return { poses };
    }),
}));
