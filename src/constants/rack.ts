import { Vector3 } from "three";
import type { EquipmentPose } from "@/types/layout";
import { STREAM_CONFIG } from "@/constants/simulation";

/**
 * rack.glb in metres, origin at the floor centre, open (loading) face toward local +Z.
 * `slots` are the PalletPoint empties [x, y] (all at z = 0), in file order
 * (PalletPoint, .001 … .007); update them if the model's PalletPoints move.
 */
export const RACK_CONFIG = {
  /** Navigation footprint [width x, depth z]; covers the frame's z -0.56…0.84. */
  footprint: [2.7, 1.7] as [number, number],
  /** Local z of the loading face. */
  front: 0.85,
  /** Gap between the loading face and the carried pallet at the approach point. */
  approachGap: 0.35,
  slots: [
    [0.6564, 0.1688],
    [-0.572, 0.1688],
    [-0.572, 0.7408],
    [-0.572, 1.3035],
    [-0.572, 1.8709],
    [0.6564, 0.7362],
    [0.6564, 1.3035],
    [0.6564, 1.8709],
  ] as const,
  /** Pallet is raised this much above its shelf while sliding in, then set down. */
  liftClearance: 0.04,
  /** m/s for raising/lowering the pallet and for driving in/out of the slot. */
  liftSpeed: 0.35,
  insertSpeed: 0.3,
};

const local = (rack: EquipmentPose, x: number, y: number, z: number) =>
  new Vector3(x, y, z).applyAxisAngle(new Vector3(0, 1, 0), rack.yaw).add(new Vector3(rack.x, 0, rack.z));

/** World position of a PalletPoint (y = shelf height). */
export function rackSlotPoint(rack: EquipmentPose, slot: number) {
  const [x, y] = RACK_CONFIG.slots[slot];
  return local(rack, x, y, 0);
}

/** Floor point in front of a slot where the loaded AMR stops before inserting. */
export function rackApproachPoint(rack: EquipmentPose, slot: number) {
  const [x] = RACK_CONFIG.slots[slot];
  return local(rack, x, 0, RACK_CONFIG.front + STREAM_CONFIG.palletDepth / 2 + RACK_CONFIG.approachGap);
}
