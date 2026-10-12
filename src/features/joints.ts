import { Euler, MathUtils, Object3D, Quaternion, Vector3 } from "three";

const X = new Vector3(1, 0, 0);
const TO_GLTF = new Quaternion().setFromAxisAngle(X, -Math.PI / 2);
const TO_BLENDER = TO_GLTF.clone().invert();
export const JOINT_LIMITS = { hand01: [-90, 90], hand02: [-240, -50] } as const;

export function createJointControl(node: Object3D) {
  const rest = node.quaternion.clone();
  // Blender XYZ is Rz * Ry * Rx; Three.js calls this Euler order ZYX.
  const blenderRotation = TO_BLENDER.clone().multiply(rest).multiply(TO_GLTF);
  const initialX = new Euler().setFromQuaternion(blenderRotation, "ZYX").x;
  const limits = JOINT_LIMITS[node.name as keyof typeof JOINT_LIMITS];
  return { node, rest, initialX, angle: initialX,
    min: limits ? MathUtils.degToRad(limits[0]) : -Infinity,
    max: limits ? MathUtils.degToRad(limits[1]) : Infinity };
}
export type JointControl = ReturnType<typeof createJointControl>;

export function setJointAngle(control: JointControl, angle: number) {
  control.angle = MathUtils.clamp(angle, control.min, control.max);
  control.node.quaternion.copy(control.rest).multiply(
    new Quaternion().setFromAxisAngle(X, control.angle - control.initialX),
  );
  control.node.updateWorldMatrix(true, true);
}

