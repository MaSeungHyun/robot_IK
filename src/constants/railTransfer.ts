/**
 * rail_condition.glb (팔레트 분배 레일) / Transfer_Forklift.glb (레일 끝 팔레트 승강기). Native scale (1 unit = 1 m),
 * values measured from the GLBs (model space = equipment local space; yaw rotates about +y like every other object).
 */
export const RAIL_CONFIG = {
  /** Half length of the rail along its local x axis (mesh x −6.99..6.99). */
  halfLength: 6.99,
  /** Mesh z extent (−0.86..1.07): centre line offset and half width, for the nav obstacle. */
  centerZ: 0.105,
  halfWidth: 0.965,
  /** rail_condition_point: pallet bottom on the rollers (local). */
  point: { x: 0, y: 0.96, z: 0.07 },
  /** Roller speed of a pallet on the rail (m/s). */
  speed: 0.5,
  /** AMR deck → rail centre roll-off time (s). */
  depositSeconds: 2,
  /**
   * Gap (m) between the AMR body (AMR.glb half extent, not the loaded traffic circle) and the rail's outer ramp edge
   * (z 1.07) at the deposit stop: as close as possible without touching.
   */
  amrGap: 0.03,
  /** A centre pallet only leaves for a side, and a new one is only accepted, once the previous one is this far out (m). */
  clearCentre: 1.5,
  /** rail_condition holds up to 4 pallets per side, queued a pallet length + slotGap apart (front 6.32 … back 2.45 m from the centre). */
  slotsPerSide: 4,
  slotGap: 0.05,
  /**
   * Entry ramp on the AMR side (+z) of the rail centre, from rail_condition.glb (no side guides within x ±1.25):
   * chamfer from z 1.066 (y 0.890) up to z 0.900 (y 0.963), then the roller top (0.958). A deposited pallet rides
   * up the ramp and settles back on the rollers: lifted by `rise` while its centre crosses the ramp ± half a pallet.
   */
  ramp: { outerZ: 1.066, innerZ: 0.9, rise: 0.073 },
  /** A Transfer_Forklift whose pallet point is within this distance of a rail end serves that end (m). */
  transferSnap: 2.5,
} as const;

export const TRANSFER_CONFIG = {
  /** Child node that moves (forks + carriage) and the pallet point empty. */
  forkNode: "Transfer_Forklift_fork",
  point: { x: -0.06, y: 0.97, z: 1.73 },
  /** Body footprint (local): x −1.02..0.91, z −0.78..2.57. */
  footprint: { minX: -1.02, maxX: 0.91, minZ: -0.78, maxZ: 2.57 },
  /**
   * The fork only moves vertically: lowered until Transfer_Forklift_fork_end_point (child of the fork, y -0.7299 under it)
   * touches the floor. World y of the end point = 0.18557 (body) + 1.27529 (fork) - 0.72991 = 0.731 m.
   */
  downY: 0.731,
  /** Lowering time (s); the empty fork rises back in returnSeconds. */
  lowerSeconds: 3,
  returnSeconds: 3,
  /** Stoppers on both rail-axis sides of the fork: size (m) and raise/lower time (s). */
  stopper: { width: 0.08, height: 0.12, depth: 1.0, seconds: 0.4 },
} as const;