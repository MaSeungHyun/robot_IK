import { create } from "zustand";

/** Editor link mode (🔗): picking a source, then a target, creates a SceneLink. */
export const useLinkModeStore = create<{
  active: boolean;
  /** Equipment picked as the first end of the next link. */
  source: string | null;
  /** Link path selected for removal (Delete). */
  selectedLink: string | null;
  setActive: (active: boolean) => void;
  toggle: () => void;
  setSource: (id: string | null) => void;
  selectLink: (id: string | null) => void;
}>((set, get) => ({
  active: false,
  source: null,
  selectedLink: null,
  setActive: (active) => { if (get().active !== active) set({ active, source: null, selectedLink: null }); },
  toggle: () => set({ active: !get().active, source: null, selectedLink: null }),
  setSource: (source) => { if (get().source !== source) set({ source, selectedLink: null }); },
  selectLink: (selectedLink) => { if (get().selectedLink !== selectedLink) set({ selectedLink }); },
}));