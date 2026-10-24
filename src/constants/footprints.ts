import { AMR_MODEL, PALLET_MODEL, ROBOT_MODEL } from "@/constants/modelPoints.generated";

/**
 * Floor footprints derived from the authored model bounds (modelPoints.generated.ts); no hand-tuned sizes.
 * Pure data so layout code can run in a Web Worker.
 */
type Bounds = { min: [number, number, number]; max: [number, number, number] };
const half = ({ min, max }: Bounds) => [Math.max(-min[0], max[0]), Math.max(-min[2], max[2])] as const;
const [amrX, amrZ] = half(AMR_MODEL), [palletX, palletZ] = half(PALLET_MODEL);

export const MODEL_FOOTPRINT = {
  /** AMR.glb [width x, depth z] about its origin. */
  amr: [2 * amrX, 2 * amrZ] as [number, number],
  /** Circle that holds the AMR body at any heading (half diagonal). */
  amrRadius: Math.hypot(amrX, amrZ),
  /** Circle that holds the pallet at any yaw (half diagonal). */
  palletRadius: Math.hypot(palletX, palletZ),
  /** RobotArm.glb base + turret swept radius. */
  robotRadius: ROBOT_MODEL.baseRadius,
  robot: [2 * ROBOT_MODEL.baseRadius, 2 * ROBOT_MODEL.baseRadius] as [number, number],
};
