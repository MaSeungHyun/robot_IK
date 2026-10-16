import { Matrix4, Quaternion, Vector3, type Object3D } from "three";
import { blenderWorldX, type JointControl } from "./joints";
import { NUMERICAL_IK } from "../../constants/simulation";

export type ToolPose = { position: Vector3; rotation: Quaternion; wristPosition: Vector3; wristRotation: Quaternion; direction: Vector3 };

// A separate FK model: numerical exploration never changes the displayed GLB.
export function createKinematics(controls: JointControl[], tip: Object3D, wrist: Object3D) {
  const chain: Object3D[] = [];
  for (let node: Object3D | null = tip; node; node = node.parent) chain.unshift(node);
  const links = chain.map(node => ({
    position: node.position.clone(), scale: node.scale.clone(), rotation: node.quaternion.clone(),
    index: controls.findIndex(control => control.node === node), wrist: node === wrist,
  }));
  const matrix = new Matrix4(), local = new Matrix4(), rotation = new Quaternion();
  const wristPosition = new Vector3(), wristRotation = new Quaternion(), scale = new Vector3();
  function forward(angles: number[]): ToolPose {
    matrix.identity();
    for (const link of links) {
      const control = controls[link.index];
      rotation.copy(link.rotation);
      if (control) rotation.copy(control.rest).multiply(new Quaternion().setFromAxisAngle(control.axis, angles[link.index] - control.initialX));
      matrix.multiply(local.compose(link.position, rotation, link.scale));
      if (link.wrist) { wristPosition.setFromMatrixPosition(matrix); matrix.decompose(new Vector3(),wristRotation,scale); }
    }
    const position = new Vector3(), quaternion = new Quaternion();
    matrix.decompose(position, quaternion, scale);
    return { position, rotation: quaternion.normalize(), wristPosition:wristPosition.clone(), wristRotation:wristRotation.clone().normalize(), direction: position.clone().sub(wristPosition).normalize() };
  }
  return { forward };
}

function linearSolve(matrix: number[][], vector: number[]) {
  const n = vector.length, rows = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let i = column + 1; i < n; i++) if (Math.abs(rows[i][column]) > Math.abs(rows[pivot][column])) pivot = i;
    if (Math.abs(rows[pivot][column]) < 1e-14) return null;
    [rows[pivot], rows[column]] = [rows[column], rows[pivot]];
    const divisor = rows[column][column];
    for (let j = column; j <= n; j++) rows[column][j] /= divisor;
    for (let i = 0; i < n; i++) if (i !== column) {
      const factor = rows[i][column];
      for (let j = column; j <= n; j++) rows[i][j] -= factor * rows[column][j];
    }
  }
  return rows.map(row => row[n]);
}

export type NumericResult = { angles: number[]; error: number; tilt: number; converged: boolean };
export function* solvePosition(
  forward: (angles: number[]) => ToolPose, seed: number[], limits: [number, number][],
  target: Vector3, downward: boolean, positionTolerance: number, tiltTolerance: number, worldWristRange?: readonly [number,number],
): Generator<void, NumericResult, void> {
  let angles = seed.map((value, i) => Math.max(limits[i][0], Math.min(limits[i][1], value)));
  let damping = NUMERICAL_IK.initialDamping;
  const residual = (pose: ToolPose) => {
    const p = pose.position.clone().sub(target);
    if(worldWristRange){
      const angle=blenderWorldX(pose.wristRotation);
      const outside=angle-Math.max(worldWristRange[0],Math.min(worldWristRange[1],angle));
      return [p.x,p.y,p.z,outside*NUMERICAL_IK.orientationLength];
    }
    const tilt = pose.direction.angleTo(new Vector3(0,-1,0));
    // A cone, not a full quaternion equality: use the allowed tilt instead
    // of sacrificing position accuracy to chase an unnecessary exact angle.
    const cone = Math.max(0, tilt - tiltTolerance * 0.8) / Math.max(tilt,1e-9);
    return downward ? [p.x,p.y,p.z,
      pose.direction.x * NUMERICAL_IK.orientationLength * cone,
      (pose.direction.y+1) * NUMERICAL_IK.orientationLength * cone,
      pose.direction.z * NUMERICAL_IK.orientationLength * cone] : [p.x,p.y,p.z];
  };
  const norm = (values: number[]) => values.reduce((sum, value) => sum + value * value, 0);
  let best: NumericResult = { angles: [...angles], error: Infinity, tilt: Infinity, converged: false };
  let bestCost = Infinity;
  for (let iteration = 0; iteration < NUMERICAL_IK.iterations; iteration++) {
    const pose = forward(angles), error = pose.position.distanceTo(target);
    const tilt = pose.direction.angleTo(new Vector3(0, -1, 0));
    const r = residual(pose), cost = norm(r);
    if (cost < bestCost) { bestCost = cost; best = { angles: [...angles], error, tilt, converged: false }; }
    const releaseAngle=blenderWorldX(pose.wristRotation);
    const orientationOK=worldWristRange ? releaseAngle>=worldWristRange[0]-1e-6&&releaseAngle<=worldWristRange[1]+1e-6 : !downward||tilt<=tiltTolerance;
    if (error <= positionTolerance && orientationOK) return { angles, error, tilt, converged: true };
    const columns = angles.map((angle, i) => {
      if (limits[i][0] === limits[i][1]) return r.map(() => 0);
      const h = angle + NUMERICAL_IK.derivativeStep <= limits[i][1] ? NUMERICAL_IK.derivativeStep : -NUMERICAL_IK.derivativeStep;
      const sample = [...angles]; sample[i] += h;
      return residual(forward(sample)).map((value, j) => (value - r[j]) / h);
    });
    const normal = columns.map((column, i) => columns.map((other, j) =>
      column.reduce((sum, value, k) => sum + value * other[k], 0) + (i === j ? damping : 0)));
    const rhs = columns.map(column => -column.reduce((sum, value, k) => sum + value * r[k], 0));
    const step = linearSolve(normal, rhs);
    if (!step) break;
    const gain = Math.min(1, NUMERICAL_IK.maxJointStep / Math.max(...step.map(Math.abs), 1e-12));
    const next = angles.map((angle, i) => Math.max(limits[i][0], Math.min(limits[i][1], angle + step[i] * gain)));
    if (norm(residual(forward(next))) < cost) { angles = next; damping = Math.max(NUMERICAL_IK.minimumDamping, damping * 0.5); }
    else damping = Math.min(NUMERICAL_IK.maximumDamping, damping * 4);
    if (iteration % NUMERICAL_IK.iterationsPerSlice === 0) yield;
    if (damping === NUMERICAL_IK.maximumDamping) break;
  }
  return best;
}
