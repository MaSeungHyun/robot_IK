import { Vector3 } from "three";
import type { EquipmentPose } from "@/types/layout";
import { RACK_LIFT_CLEARANCE, STREAM_CONFIG } from "@/constants/simulation";
import { RACK_MODEL } from "@/constants/modelPoints.generated";
import { MODEL_FOOTPRINT } from "@/constants/footprints";

/**
 * Rack.glb in metres, used as authored: origin at the floor centre, the shelves run along local Z
 * and the loading face looks toward local +X. Slots are the model's slot empties
 * (`Rack_point`, `Rack_L_point`, `Rack_2R_point` ...), read by scripts/gen-model-points.mjs into
 * modelPoints.generated.ts (level 1 = bottom, column L/C/R). Each point is the pallet's bottom centre.
 */
export type RackSlot = { name: string; level: number; column: "L" | "C" | "R"; x: number; y: number; z: number };

const [minX, , minZ] = RACK_MODEL.min,
  [maxX, , maxZ] = RACK_MODEL.max;

export const RACK_CONFIG = {
  /** Navigation footprint [width x, depth z] of the frame (centred on the origin, small margin). */
  footprint: [2 * Math.max(-minX, maxX) + 0.05, 2 * Math.max(-minZ, maxZ) + 0.05] as [number, number],
  /** Local x of the loading face (faces +X). */
  front: maxX,
  /** Gap between the loading face and the carried pallet at the approach point. */
  approachGap: 0.35,
  /** Loading face -> AMR stop distance: the pallet keeps approachGap and the AMR body circle (AMR.glb) clears the frame footprint. */
  get approachStandoff() {
    return rackStandoff(0);
  },
  slots: RACK_MODEL.slots as RackSlot[],
  /** Pallet is raised this much above its shelf while sliding in, then set down. */
  liftClearance: RACK_LIFT_CLEARANCE,
  /** m/s for raising/lowering the pallet and for driving in/out of the slot. */
  liftSpeed: 0.35,
  insertSpeed: 0.3,
};

/** Face -> stop distance with `extra` m added to the pallet gap, never closer than the AMR body circle allows. */
export function rackStandoff(extra: number) {
  const frameMargin = (2 * Math.max(-minX, maxX) + 0.05) / 2 - maxX;
  return Math.max(STREAM_CONFIG.palletDepth / 2 + 0.35 + extra, MODEL_FOOTPRINT.amrRadius + frameMargin + 0.05);
}

const local = (rack: EquipmentPose, x: number, y: number, z: number) =>
  new Vector3(x, y, z).applyAxisAngle(new Vector3(0, 1, 0), rack.yaw).add(new Vector3(rack.x, 0, rack.z));

/** World position of a slot point (y = shelf height). */
export function rackSlotPoint(rack: EquipmentPose, slot: number) {
  const { x, y, z } = RACK_CONFIG.slots[slot];
  return local(rack, x, y, z);
}

/** Add to a "face along local +Z" yaw to get the Rack.glb yaw whose loading face (+X) points the same way. */
export const RACK_FACE_YAW = -Math.PI / 2;

/** Heading (rotation.y, forward = +Z) of a vehicle facing into the rack's loading face. */
export function rackHeading(rack: EquipmentPose) {
  return rack.yaw - Math.PI / 2;
}

/** Floor point at `distance` m out from the slot point, straight out of the loading face. */
export function rackFacePoint(rack: EquipmentPose, slot: number, distance: number) {
  const { x, z } = RACK_CONFIG.slots[slot];
  return local(rack, x + distance, 0, z);
}

/** Floor point in front of a slot where the loaded pallet AMR stops before inserting. */
export function rackApproachPoint(rack: EquipmentPose, slot: number) {
  const { x } = RACK_CONFIG.slots[slot];
  return rackFacePoint(rack, slot, RACK_CONFIG.front - x + rackStandoff(0));
}