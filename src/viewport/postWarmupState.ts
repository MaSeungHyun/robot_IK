import { create } from "zustand";

/** While true, PostProcessing mounts the factory effect chain (selective bloom + AgX) so its programs compile at startup. */
export const usePostWarmup = create<{ active: boolean }>(() => ({ active: false }));
