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
  inflate: 0.03,
};
/** Traffic replans (stall / detour / side step / fallback route) follow the grid axes instead of any-angle diagonals. */
/**
 * Cooperative (joint) resolution of a stuck pair (AMR-AMR, AMR-forklift): when side steps / make-way fail or a
 * hold lasts, both vehicles are planned together (who retreats where, who pockets where) with a short space-time
 * check, and the cheapest conflict-free combination is committed. Bounded: `searches` path searches per attempt.
 */
export const AMR_COOPERATION = {
  /** Waiting / holding this long (s) triggers a joint plan. */
  after: 2.4,
  /** Min seconds between joint plans involving the same vehicle. */
  cooldown: 2,
  /** Space-time check horizon (s) and sample step (s). */
  horizon: 6,
  step: 0.1,
  /** Pocket cells tried for the clearing vehicle (per ordering). */
  pockets: 3,
  /** Retreat distances (m, away from the other vehicle) tried for the passing vehicle. */
  retreats: [0.9, 1.6],
  /** Path searches allowed per joint plan (perf cap). */
  searches: 10,
  /** Cost weight of a move that has to be driven back (pocket / retreat round trip). */
  returnWeight: 2,
};
export const AMR_AXIS_PATH = {
  /** Extra A* cost (grid cells) per 90° turn: fewer, longer straight legs instead of staircases. */
  turnCost: 2,
};
