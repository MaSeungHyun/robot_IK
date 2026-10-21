import { create } from "zustand";

export type LogLevel = "info" | "warning" | "error";
export type LogEntry = { id: number; level: LogLevel; message: string; detail?: string; at: number };

const LIMIT = 200;
let nextId = 1;

/** App-wide log (model load failures etc.), newest last, capped at LIMIT entries. */
export const useLogStore = create<{
  entries: LogEntry[];
  add: (level: LogLevel, message: string, detail?: string) => void;
  clear: () => void;
}>((set) => ({
  entries: [],
  add: (level, message, detail) =>
    set((state) => ({
      entries: [...state.entries, { id: nextId++, level, message, detail, at: Date.now() }].slice(-LIMIT),
    })),
  clear: () => set({ entries: [] }),
}));

export const log = (level: LogLevel, message: string, detail?: string) =>
  useLogStore.getState().add(level, message, detail);
