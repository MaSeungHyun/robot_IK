import { create } from "zustand";
import type { LayoutConstraints, Wall } from "@/domain/layout/autoLayout";
import type { SearchResult } from "@/domain/layout/searchLayouts";
import { runAutoLayout, type AutoLayoutRun } from "@/workers/autoLayoutClient";

export type AutoLayoutForm = {
  width: number; depth: number; height: number; targetPerHour: number;
  /** R-STORAGE: hours of output stored in racks. */
  storageHours: number;
  door: Wall | "none"; doorOffset: number; doorWidth: number;
  maxRobots: number; maxAmrs: number;
  /** 0 = no limit. */
  maxRacks: number;
};
export const DEFAULT_AUTO_LAYOUT_FORM: AutoLayoutForm = {
  width: 30, depth: 20, height: 6, targetPerHour: 600, storageHours: 2,
  door: "none", doorOffset: 0, doorWidth: 3, maxRobots: 12, maxAmrs: 6, maxRacks: 0,
};
export function formToConstraints(form: AutoLayoutForm): LayoutConstraints {
  return {
    width: form.width, depth: form.depth, height: form.height, targetPerHour: form.targetPerHour,
    storageHours: form.storageHours, maxRobots: form.maxRobots, maxAmrs: form.maxAmrs,
    ...(form.maxRacks > 0 ? { maxRacks: form.maxRacks } : {}),
    ...(form.door !== "none" ? { door: { wall: form.door, offset: form.doorOffset, width: form.doorWidth } } : {}),
  };
}

type Status = "idle" | "running" | "done" | "error";
interface AutoLayoutState {
  open: boolean;
  form: AutoLayoutForm;
  status: Status;
  progress: { evaluated: number; total: number; current: string };
  result: SearchResult | null;
  error: string | null;
  setOpen: (open: boolean) => void;
  setForm: (patch: Partial<AutoLayoutForm>) => void;
  start: () => void;
  cancel: () => void;
}

let active: AutoLayoutRun | null = null;

export const useAutoLayoutStore = create<AutoLayoutState>((set, get) => ({
  open: false,
  form: DEFAULT_AUTO_LAYOUT_FORM,
  status: "idle",
  progress: { evaluated: 0, total: 0, current: "" },
  result: null,
  error: null,
  setOpen: (open) => set({ open }),
  setForm: (patch) => set((state) => ({ form: { ...state.form, ...patch } })),
  start: () => {
    active?.cancel();
    const run = runAutoLayout(formToConstraints(get().form), (evaluated, total, current) => {
      if (active === run) set({ progress: { evaluated, total, current } });
    });
    active = run;
    set({ status: "running", result: null, error: null, progress: { evaluated: 0, total: 0, current: "모델 불러오는 중" } });
    run.promise.then(
      (result) => { if (active === run) { active = null; set({ status: "done", result }); } },
      (error: Error) => { if (active === run) { active = null; set({ status: error.name === "AbortError" ? "idle" : "error", error: error.name === "AbortError" ? null : error.message }); } },
    );
  },
  cancel: () => {
    const run = active;
    active = null;
    run?.cancel();
    set({ status: "idle" });
  },
}));
