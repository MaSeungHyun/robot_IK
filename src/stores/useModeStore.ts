import { create } from "zustand";

type Mode = "simulation" | "monitoring";

export const useModeStore = create<{
  mode: Mode;
  setMode: (mode: Mode) => void;
}>((set) => ({
  mode: "simulation",
  setMode: (mode: Mode) => set({ mode }),
}));
