/**
 * ScanTunnel.glb is the start of a line: it stands over the first rail with its belt entry at the rail start,
 * so boxes spawn inside it, pass the scan point and leave its exit onto the rail (flow +z in both models).
 * The tunnel's own exit belt sits on the rail belt (lifted by `clearance` against z-fighting); with the models
 * as authored this sinks the tunnel slightly into the floor (see `sink`).
 */
import { SCAN_TUNNEL_MODEL as T } from "@/constants/modelPoints.generated";
import { CONVEYOR_LAYOUT as BELT } from "@/constants/conveyorLayoutConfig";
import { beltPoint } from "@/domain/conveyor/conveyorLayout";
import type { ConveyorTurn } from "@/types/layout";

const clearance = 0.003;
export const SCAN_TUNNEL = {
  width: T.max[0] - T.min[0],
  length: T.max[2] - T.min[2],
  /** Mesh-local -> scanner-local y offset (exit belt top on the rail belt). */
  lift: BELT.height + clearance - T.exitBeltTop,
  /** How far the tunnel mesh bottom ends below the floor (> 0) with that lift. */
  sink: -(BELT.height + clearance - T.exitBeltTop + T.min[1]),
  /** Distance along the first rail from its start to the tunnel origin (belt entry at the rail start). */
  startOffset: -T.beltZ[0],
  /** Distance along the rail at which boxes leave the tunnel exit. */
  exitDistance: T.beltZ[1] - T.beltZ[0],
  halfBeltWidth: (T.beltX[1] - T.beltX[0]) / 2,
} as const;

type Belt = { x: number; z: number; yaw: number; conveyorTurn?: ConveyorTurn };
/** Scanner pose for a tunnel heading the line that starts at `belt` (a straight rail). */
export function scanTunnelPose(belt: Belt) {
  const p = beltPoint(belt, SCAN_TUNNEL.startOffset);
  return { x: p.x, z: p.z, yaw: p.yaw };
}