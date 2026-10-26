import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createCookieStorage } from "@/lib/storage/cookieStorage";
import { DEFAULT_KPI_CONFIG, type KpiReport } from "@/domain/kpi/KpiCollector";

export const KPI_SAMPLE_INTERVALS = [0.5, 1, 2, 5] as const;
export const KPI_CELL_SIZES = [1, 2, 4] as const;

/** KPI preferences (persisted cookie) + the latest report of the mounted run (transient). */
interface KpiState {
  /** Sim seconds between KPI samples (results are identical at every playback speed). */
  sampleInterval: number;
  /** Floor cell size (m) for AMR occupancy hotspots. */
  cellSize: number;
  /** Show the KPI panel in the dashboard tab. */
  panel: boolean;
  report: KpiReport | null;
  setSampleInterval: (value: number) => void;
  setCellSize: (value: number) => void;
  setPanel: (value: boolean) => void;
  setReport: (report: KpiReport | null) => void;
}

const pick = <T extends number>(list: readonly T[], value: unknown, fallback: T): T => (list.includes(value as T) ? (value as T) : fallback);
function sanitize(raw: unknown) {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    sampleInterval: pick(KPI_SAMPLE_INTERVALS, value.sampleInterval, DEFAULT_KPI_CONFIG.interval as 1),
    cellSize: pick(KPI_CELL_SIZES, value.cellSize, DEFAULT_KPI_CONFIG.cellSize as 2),
    panel: typeof value.panel === "boolean" ? value.panel : true,
  };
}

export const useKpiStore = create<KpiState>()(
  persist(
    (set) => ({
      ...sanitize(null),
      report: null,
      setSampleInterval: (sampleInterval) => set({ sampleInterval }),
      setCellSize: (cellSize) => set({ cellSize }),
      setPanel: (panel) => set({ panel }),
      setReport: (report) => set({ report }),
    }),
    {
      name: "sf_kpi",
      version: 1,
      storage: createJSONStorage(() => createCookieStorage()),
      partialize: ({ sampleInterval, cellSize, panel }) => ({ sampleInterval, cellSize, panel }),
      migrate: (persisted) => sanitize(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitize(persisted) }),
    },
  ),
);