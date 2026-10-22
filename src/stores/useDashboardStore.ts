import { create } from "zustand";
import { DashboardSampler, type DashboardSnapshot } from "@/domain/stats/dashboardStats";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useCargoStore } from "@/stores/useCargoStore";

/** Wall-clock interval (ms) between published dashboard snapshots. */
const PUBLISH_MS = 1000;

const sampler = new DashboardSampler();
let publishedAt = 0;

/** Dashboard dialog visibility + the 1 Hz published snapshot (null before a run). */
export const useDashboardStore = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
  snapshot: DashboardSnapshot | null;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  snapshot: null,
}));

/** Current aggregated dashboard state as a plain serializable object (built on demand). */
export function getDashboardSnapshot(): DashboardSnapshot {
  const { registry, transport } = useCargoStore.getState();
  return sampler.snapshot(registry, transport);
}

// Fed at the HUD report rate (equipment snapshots); published to React at most once per second.
useSimulationStore.subscribe((state, previous) => {
  if (state.equipment === previous.equipment) return;
  if (!state.equipment) {
    sampler.reset();
    publishedAt = 0;
    useDashboardStore.setState({ snapshot: null });
    return;
  }
  sampler.sample(state.equipment, useCargoStore.getState().registry);
  const now = performance.now();
  if (now - publishedAt < PUBLISH_MS) return;
  publishedAt = now;
  useDashboardStore.setState({ snapshot: getDashboardSnapshot() });
});