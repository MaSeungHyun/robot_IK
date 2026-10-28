import { create } from "zustand";

/** Load stages of a progressive template load (0 = download, 1 structure, 2 conveyors, 3 equipment, 4 racks, 5 pallets/props). */
export const LOAD_STAGES = ["다운로드", "바닥·벽·구조물", "컨베이어", "설비", "랙", "팔레트·소품"] as const;

type TemplateLoadState = {
  /** A template is loading/revealing: simulation play is blocked until it finishes. */
  active: boolean;
  stage: number;
  /** Prop sources (GLB urls) still building their chunks. */
  pending: number;
  /** Equipment drop-in released (after the structure chunk) and when its last drop ends (performance.now ms). */
  released: boolean;
  endsAt: number;
  /** Stage start times on the performance clock (equipment chunks follow the drop-in schedule). */
  stageAt: number[];
  startedAt: number;
  firstVisibleMs: number | null;
  totalMs: number | null;
  begin: (sources: number) => void;
  /** First content on screen (structure chunk or first equipment drop). */
  visible: () => void;
  setStage: (stage: number) => void;
  release: (endsAt: number, stageAt: number[]) => void;
  sourceDone: () => void;
  tick: (now: number) => void;
};

let timer: ReturnType<typeof setInterval> | null = null;

export const useTemplateLoadStore = create<TemplateLoadState>((set, get) => ({
  active: false, stage: 0, pending: 0, released: false, endsAt: 0, stageAt: [], startedAt: 0, firstVisibleMs: null, totalMs: null,
  begin: (sources) => {
    set({ active: true, stage: 0, pending: sources, released: false, endsAt: 0, stageAt: [], startedAt: performance.now(), firstVisibleMs: null, totalMs: null });
    if (timer) clearInterval(timer);
    timer = setInterval(() => get().tick(performance.now()), 100);
  },
  visible: () => { const s = get(); if (s.active && s.firstVisibleMs === null) set({ firstVisibleMs: performance.now() - s.startedAt }); },
  setStage: (stage) => { if (get().active && stage > get().stage) set({ stage }); },
  release: (endsAt, stageAt) => { if (get().active && !get().released) set({ released: true, endsAt, stageAt }); },
  sourceDone: () => set((s) => ({ pending: Math.max(0, s.pending - 1) })),
  tick: (now) => {
    const s = get();
    if (!s.active) return;
    const stage = s.stageAt.reduce((acc, at, i) => (at <= now ? Math.max(acc, i) : acc), s.stage);
    if (stage !== s.stage) set({ stage });
    if (!s.released || s.pending > 0 || now < s.endsAt) return;
    const totalMs = now - s.startedAt;
    set({ active: false, stage: LOAD_STAGES.length - 1, totalMs });
    if (timer) { clearInterval(timer); timer = null; }
    console.info(`[templateLoad] firstVisible ${Math.round(s.firstVisibleMs ?? totalMs)} ms · total ${Math.round(totalMs)} ms`);
  },
}));
