import { create } from "zustand";

/** Asset thumbnails baked once by ThumbnailBaker, as data URLs keyed by thumbnail key. */
export const useThumbnailStore = create<{
  thumbnails: Record<string, string>;
  /** True once baking finished (even if it failed; cards then fall back to icons). */
  baked: boolean;
  setThumbnails: (thumbnails: Record<string, string>) => void;
}>((set) => ({
  thumbnails: {},
  baked: false,
  setThumbnails: (thumbnails) => set({ thumbnails, baked: true }),
}));
