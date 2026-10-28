import { create } from "zustand";

/** Editor link mode (🔗): picking a source, then a target, creates a SceneLink. */
export const useLinkModeStore = create<{
  active: boolean;
  /** Equipment picked as the first end of the next link. */
  source: string | null;
  /** Link path selected for removal (Delete). */
  selectedLink: string | null;
  /** Valid link target under the pointer while picking (orange outline preview). */
  hover: string | null;
  setHover: (id: string | null) => void;
  setActive: (active: boolean) => void;
  toggle: () => void;
  setSource: (id: string | null) => void;
  selectLink: (id: string | null) => void;
}>((set, get) => ({
  active: false,
  source: null,
  selectedLink: null,
  hover: null,
  setHover: (hover) => { if (get().hover !== hover) set({ hover }); },
  setActive: (active) => { if (get().active !== active) set({ active, source: null, selectedLink: null, hover: null }); },
  toggle: () => set({ active: !get().active, source: null, selectedLink: null, hover: null }),
  setSource: (source) => { if (get().source !== source) set({ source, selectedLink: null }); },
  selectLink: (selectedLink) => { if (get().selectedLink !== selectedLink) set({ selectedLink }); },
}));