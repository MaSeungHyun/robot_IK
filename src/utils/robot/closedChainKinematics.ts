import { Goal, Joint, Link, Solver } from "closed-chain-ik/core";
import type { DOF as JointAxis } from "closed-chain-ik/core";
import { Euler, MathUtils, Quaternion, Vector3, type Object3D } from "three";
import { CLOSED_CHAIN_IK, NUMERICAL_IK } from "../../constants/simulation";
import { blenderWorldX, type JointControl } from "./joints";
import { createKinematics as createForwardKinematics, type NumericResult, type ToolPose } from "./robotKinematics";

type Forward = (angles: number[]) => ToolPose;
type Chain = ReturnType<typeof buildChain>;
// The package declares its runtime DOF object as an ambient const enum, incompatible with verbatimModuleSyntax.
const DOF = { X: 0, Y: 1, Z: 2, EX: 3, EY: 4, EZ: 5 } as const satisfies Record<string, JointAxis>;
const chains = new WeakMap<Forward, Chain>();
const DOWN = new Vector3(0, -1, 0);
const LOCAL_X = new Vector3(1, 0, 0);
const TO_GLTF = new Quaternion().setFromAxisAngle(LOCAL_X, -Math.PI / 2);

function buildChain(controls: JointControl[], tip: Object3D, wrist: Object3D) {
  const nodes: Object3D[] = [];
  for (let node: Object3D | null = tip; node; node = node.parent) nodes.unshift(node);
  const root = new Link();
  let parent = root;
  let scale = 1;
  let wristLink = root;
  const joints: { joint: Joint; dof: JointAxis; control: JointControl }[] = [];
  for (const node of nodes) {
    if (Math.abs(node.scale.x - node.scale.y) > 1e-6 || Math.abs(node.scale.x - node.scale.z) > 1e-6 || node.scale.x <= 0) {
      throw new Error("closed-chain-ik requires positive uniform scale on the robot hierarchy");
    }
    const control = controls.find(item => item.node === node);
    const joint = new Joint();
    joint.name = node.name;
    joint.setPosition(node.position.x * scale, node.position.y * scale, node.position.z * scale);
    const rotation = control?.rest ?? node.quaternion;
    joint.setQuaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    if (control) {
      const dof = control.dof === "EY" ? DOF.EY : DOF.EX;
      joint.setDoF(dof);
      joints[controls.indexOf(control)] = { joint, dof, control };
    }
    const link = new Link();
    parent.addChild(joint);
    joint.addChild(link);
    parent = link;
    if (node === wrist) wristLink = link;
    scale *= node.scale.x;
  }
  const goal = new Goal();
  goal.setGoalDoF(DOF.X, DOF.Y, DOF.Z);
  goal.makeClosure(parent);
  const wristGoal = new Goal();
  wristGoal.setGoalDoF();
  wristGoal.makeClosure(wristLink);
  const solver = new Solver(root);
  solver.maxIterations = CLOSED_CHAIN_IK.iterationsPerSlice;
  solver.dampingFactor = CLOSED_CHAIN_IK.damping;
  solver.stallThreshold = CLOSED_CHAIN_IK.stallThreshold;
  solver.translationErrorClamp = CLOSED_CHAIN_IK.translationStep;
  solver.rotationErrorClamp = CLOSED_CHAIN_IK.rotationStep;
  solver.restPoseFactor = CLOSED_CHAIN_IK.restPoseFactor;
  return { root, joints, tip: parent, wrist: wristLink, goal, wristGoal, solver, orientationMode: "none" };
}

/** Solver frames are separate from the visible GLB; rotations are offsets from each imported rest pose. */
export function createKinematics(controls: JointControl[], tip: Object3D, wrist: Object3D) {
  const forward = createForwardKinematics(controls, tip, wrist).forward;
  const chain = buildChain(controls, tip, wrist);
  chains.set(forward, chain);
  return {
    forward,
    solverPosition(angles: number[]) {
      chain.joints.forEach(({ joint, dof, control }, i) => joint.setDoFValue(dof, angles[i] - control.initialX));
      const point: number[] = [];
      chain.tip.getWorldPosition(point);
      return new Vector3().fromArray(point);
    },
  };
}

export function* solvePosition(
  forward: Forward, seed: number[], limits: [number, number][], target: Vector3,
  downward: boolean, positionTolerance: number, tiltTolerance: number, worldWristRange?: readonly [number, number],
): Generator<void, NumericResult, void> {
  const chain = chains.get(forward);
  if (!chain) throw new Error("closed-chain-ik forward model was not registered");
  const { joints, solver, goal, wristGoal } = chain;
  const angles = seed.map((value, i) => MathUtils.clamp(value, ...limits[i]));
  joints.forEach(({ joint, dof, control }, i) => {
    joint.setMinLimits(limits[i][0] - control.initialX);
    joint.setMaxLimits(limits[i][1] - control.initialX);
    joint.setDoFValue(dof, angles[i] - control.initialX);
    joint.setRestPoseValues(angles[i] - control.initialX);
    joint.restPoseSet = true;
  });
  goal.setPosition(target.x, target.y, target.z);
  solver.translationConvergeThreshold = positionTolerance * CLOSED_CHAIN_IK.goalToleranceScale;
  solver.rotationConvergeThreshold = CLOSED_CHAIN_IK.rotationTolerance;
  let best: NumericResult = { angles: [...angles], error: Infinity, tilt: Infinity, converged: false };
  let bestCost = Infinity;
  const axis = new Vector3(), perpendicular = new Vector3(), currentPerpendicular = new Vector3(), desired = new Vector3(), wristTarget = new Vector3();
  for (let iteration = 0; iteration < CLOSED_CHAIN_IK.maxSlices; iteration++) {
    joints.forEach(({ joint, dof, control }, i) => { angles[i] = MathUtils.clamp(Number(joint.getDoFValue(dof)) + control.initialX, ...limits[i]); });
    const pose = forward(angles);
    const error = pose.position.distanceTo(target), tilt = pose.direction.angleTo(DOWN);
    const releaseAngle = blenderWorldX(pose.wristRotation);
    const outside = worldWristRange ? releaseAngle - MathUtils.clamp(releaseAngle, ...worldWristRange) : 0;
    const orientationError = worldWristRange ? Math.abs(outside) : downward ? Math.max(0, tilt - tiltTolerance) : 0;
    const cost = error * error + (orientationError * NUMERICAL_IK.orientationLength) ** 2;
    if (cost < bestCost) { bestCost = cost; best = { angles: [...angles], error, tilt, converged: false }; }
    if (error <= positionTolerance && orientationError <= 1e-6) return { angles: [...angles], error, tilt, converged: true };

    let mode = "none";
    if (worldWristRange && Math.abs(outside) > 1e-6) {
      mode = "rotation";
      const blender = TO_GLTF.clone().invert().multiply(pose.wristRotation).multiply(TO_GLTF);
      const euler = new Euler().setFromQuaternion(blender, "ZYX");
      euler.x = MathUtils.clamp(euler.x, ...worldWristRange);
      const rotation = TO_GLTF.clone().multiply(new Quaternion().setFromEuler(euler)).multiply(TO_GLTF.clone().invert());
      wristGoal.setQuaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    } else if (downward && tilt > tiltTolerance) {
      mode = "direction";
      // Preserve the component along the wrist axis: locked hand03 cannot provide arbitrary tool roll.
      axis.copy(LOCAL_X).applyQuaternion(pose.wristRotation).normalize();
      const parallel = MathUtils.clamp(pose.direction.dot(axis), -1, 1);
      perpendicular.copy(DOWN).addScaledVector(axis, -DOWN.dot(axis)).normalize();
      currentPerpendicular.copy(pose.direction).addScaledVector(axis,-parallel).normalize();
      const radius=Math.sqrt(1-parallel*parallel);
      let low=0,high=1;
      for(let step=0;step<CLOSED_CHAIN_IK.coneSearchIterations;step++){
        const fraction=(low+high)/2;
        desired.copy(currentPerpendicular).lerp(perpendicular,fraction).normalize().multiplyScalar(radius).addScaledVector(axis,parallel);
        if(desired.angleTo(DOWN)>tiltTolerance-CLOSED_CHAIN_IK.coneCorrectionMargin)low=fraction;else high=fraction;
      }
      desired.copy(currentPerpendicular).lerp(perpendicular,high).normalize().multiplyScalar(radius).addScaledVector(axis,parallel);
      wristTarget.copy(target).addScaledVector(desired, -pose.position.distanceTo(pose.wristPosition));
      wristGoal.setPosition(wristTarget.x, wristTarget.y, wristTarget.z);
    }
    if (chain.orientationMode !== mode) {
      if (mode === "direction") wristGoal.setGoalDoF(DOF.X, DOF.Y, DOF.Z);
      else if (mode === "rotation") wristGoal.setGoalDoF(DOF.EX, DOF.EY, DOF.EZ);
      else wristGoal.setGoalDoF();
      chain.orientationMode = mode;
      solver.updateStructure();
    }
    solver.solve();
    const moved=joints.some(({joint,dof,control},i)=>Math.abs(MathUtils.clamp(Number(joint.getDoFValue(dof))+control.initialX,...limits[i])-angles[i])>CLOSED_CHAIN_IK.stallThreshold);
    if(!moved&&iteration>0)return best;
    yield;
  }
  return best;
}
