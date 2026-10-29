import { create } from "zustand";
import type { KpiReport } from "@/domain/kpi/KpiCollector";

/**
 * Latest KPI report of the mounted run (transient, not persisted).
 * Sampling uses the fixed DEFAULT_KPI_CONFIG; the old "sf_kpi" settings cookie is no longer read.
 */
interface KpiState {
  report: KpiReport | null;
  setReport: (report: KpiReport | null) => void;
}

export const useKpiStore = create<KpiState>()((set) => ({
  report: null,
  setReport: (report) => set({ report }),
}));
