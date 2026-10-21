export const JOINT_READINGS_INTERVAL_MS = 100;

export const MOCK_TELEMETRY_CONFIG = {
  intervalMs: 1000,
  motorTemperature: { min: 40, max: 65, change: 0.4 },
  controllerTemperature: { min: 35, max: 58, change: 0.3 },
  cycleTime: { min: 10, max: 16, change: 0.2 },
  power: { min: 1.5, max: 4.5, change: 0.15 },
  latency: { min: 8, max: 25, change: 2 },
  initialOperations: { min: 1000, max: 15000 },
  jointCount: 6,
  jointLoad: { min: 10, max: 90, change: 6 },
  suctionHolding: { min: -85, max: -60, change: 2 },
  suctionIdle: { min: -3, max: 0, change: 0.5 },
  boxWeight: { min: 2, max: 18 },
  payload: { min: 20, max: 120 },
  motorLoad: { min: 25, max: 85, change: 4 },
  programs: ["PICK_AND_PLACE_01", "PALLETIZE_02", "TRANSFER_03"],
  parts: ["BOX-A01", "BOX-B02", "BOX-C03"],
} as const;

/** Display-only smoothing of discrete telemetry samples (see src/lib/interpolation.ts). */
export const TELEMETRY_INTERPOLATION = {
  /** Exponential-smoothing time constant as a fraction of the sample interval (fallback when unbuffered). */
  smoothingTauRatio: 0.35,
  /** Minimum gap between DOM text writes for smoothed HUD numbers (~30 Hz). */
  textUpdateMs: 33,
} as const;

/** Mirrors REPORT_INTERVAL in useFactoryRuntime (equipment snapshot publish rate), for display smoothing only. */
export const EQUIPMENT_REPORT_INTERVAL_MS = 250;

/** AMR states counted as waiting / traffic-blocked time. */
export const AMR_WAIT_STATES = ["blocked", "waiting", "yielding"] as const;
/** AMR states in which it carries a payload. */
export const AMR_LOADED_STATES = ["loading", "dispatch", "unloading", "storing"] as const;
/** Smoothing time constant (sim s) for the estimated AMR charge rate. */
export const CHARGE_RATE_TAU_S = 5;
/** Minimum simulated seconds before per-hour throughput is shown. */
export const THROUGHPUT_MIN_ELAPSED_S = 10;
