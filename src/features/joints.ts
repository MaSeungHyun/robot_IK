import { JOINT_LIMITS } from "./constants";
export { JOINT_LIMITS } from "./constants";
import { Euler, MathUtils, Object3D, Quaternion, Vector3 } from "three";

const X = new Vector3(1, 0, 0);
const TO_GLTF = new Quaternion().setFromAxisAngle(X, -Math.PI / 2);
const TO_BLENDER = TO_GLTF.clone().invert();


export function createJointControl(node: Object3D) {
  const rest = node.quaternion.clone();
  // Blender XYZ is Rz * Ry * Rx; Three.js calls this Euler order ZYX.
  const blenderRotation = TO_BLENDER.clone().multiply(rest).multiply(TO_GLTF);
  const rotation = new Euler().setFromQuaternion(blenderRotation, "ZYX");
  const isRoll = node.name === "hand03";
  const initialX = isRoll ? rotation.z : rotation.x;
  // Export basis: Blender local +Z becomes glTF local +Y.
  const axis = isRoll ? new Vector3(0, 1, 0) : X;
  const dof = isRoll ? "EY" as const : "EX" as const;
  const limits = JOINT_LIMITS[node.name as keyof typeof JOINT_LIMITS];
  // Full-turn joints have no mechanical stop at the display-angle seam.
  const continuous = node.name === "hand02" || node.name === "hand03";
  return { node, rest, initialX, axis, dof, angle: initialX,
    min: limits && !continuous ? MathUtils.degToRad(limits[0]) : -Infinity,
    max: limits && !continuous ? MathUtils.degToRad(limits[1]) : Infinity };
}
export type JointControl = ReturnType<typeof createJointControl>;

export function setJointAngle(control: JointControl, angle: number) {
  control.angle = MathUtils.clamp(angle, control.min, control.max);
  control.node.quaternion.copy(control.rest).multiply(
    new Quaternion().setFromAxisAngle(control.axis, control.angle - control.initialX),
  );
  control.node.updateWorldMatrix(true, true);
}

