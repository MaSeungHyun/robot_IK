import { Box3, Quaternion, Vector3, type Group, type Object3D } from "three";
import { MOTION } from "../../constants/simulation";

const wristPoint = new Vector3();
const cargoBounds = new Box3();
const parentRotation = new Quaternion();

/** The wrist pivot must remain higher than the entire cargo volume, not just its origin. */
export function isWristAboveBox(wrist: Object3D, box: Group): boolean {
  wrist.getWorldPosition(wristPoint);
  cargoBounds.setFromObject(box);
  const top = cargoBounds.isEmpty() ? box.getWorldPosition(new Vector3()).y : cargoBounds.max.y;
  return wristPoint.y >= top + MOTION.contactTolerance;
}

/** Current and predicted belt positions must both lie inside the pickup circle. */
export function isPickupInRange(
  origin: Vector3,
  pickup: Vector3,
  velocity: Vector3 | undefined,
  radius: number,
  predictionSeconds: number,
): boolean {
  const dx = pickup.x - origin.x;
  const dz = pickup.z - origin.z;
  const predictedX = dx + (velocity?.x ?? 0) * predictionSeconds;
  const predictedZ = dz + (velocity?.z ?? 0) * predictionSeconds;
  return dx * dx + dz * dz <= radius * radius
    && predictedX * predictedX + predictedZ * predictedZ <= radius * radius;
}

/** Update a released cargo pose without changing its parent or jumping to its target. */
export function setCargoWorldPose(box: Group, parent: Object3D | null, position: Vector3, rotation: Quaternion): void {
  box.position.copy(position);
  box.quaternion.copy(rotation);
  if(parent){
    parent.worldToLocal(box.position);
    box.quaternion.premultiply(parent.getWorldQuaternion(parentRotation).invert());
  }
  box.updateWorldMatrix(true,true);
}
