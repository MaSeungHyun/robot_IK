export const AMR_CONFIG = {
  columns: 24, rows: 18, cellSize: .5,
  speed: 1, clearance: .08,
  taskInterval: 7, handlingSeconds: .8, statsInterval: .25,
  start: [2, 8] as const,
  dispatch: [2, 14] as const,
  pickups: [[8,3],[14,3],[20,3],[8,13],[14,13],[20,13]] as const,
  racks: [[6,5],[12,5],[18,5],[6,10],[12,10],[18,10]] as const,
  rackWidth: 1, rackDepth: 1,
};
/** AMR stall replan (sim seconds / metres; AMRTrafficController.stalled). */
export const AMR_STALL_REPLAN = {
  /** Seconds with almost no progress before braking. */
  window: 0.5,
  /** Movement (m) that counts as progress. */
  progress: 0.05,
  /** Seconds to ramp speed 1 -> 0 (and back). */
  brake: 0.25,
  /** Min seconds between stall replans of one AMR. */
  cooldown: 1,
  /** Stall replans allowed per sim step (all AMRs). */
  perStep: 2,
  /** Extra clearance (m) around other AMRs / forklifts so the detour avoids gaps narrower than the body. */
  inflate: 0.08,
};
