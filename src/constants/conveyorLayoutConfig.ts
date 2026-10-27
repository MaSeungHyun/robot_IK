import { RAIL_MODEL as RAIL } from "@/constants/modelPoints.generated";

// Straight belts are rail.glb as authored (see modelPoints.generated.ts); no rescaling.
const width = RAIL.max[0] - RAIL.min[0];
export const CONVEYOR_LAYOUT = {
  /** Straight segment length = rail.glb belt length. */
  length: RAIL.beltZ[1] - RAIL.beltZ[0],
  /** rail.glb has no 90° piece (rail_c.glb is an S lane shift), so turns stay procedural at the rail's width. */
  radius: 2 * width,
  /** Outer frame width (footprint) and moving belt width of rail.glb. */
  width,
  beltWidth: RAIL.beltX[1] - RAIL.beltX[0],
  /** Belt surface above the floor with the rail standing on the floor (mesh bottom at y = 0). */
  height: RAIL.beltTop - RAIL.min[1],
  snapDistance: .3,
  connectionTolerance: .025,
  samples: 40,
};

/**
 * Free-standing ScanTunnel.glb (factory.glb layout) carries boxes toward its mesh -z: entry at beltZ[1], exit at
 * beltZ[0]. Its own belt and an extension rail laid from the exit head this far from the scanner yaw (rad).
 */
export const SCANNER_FLOW_YAW = Math.PI;
