import { Matrix4, Quaternion, Vector3, type Object3D } from "three";
import type { JointControl } from "@/domain/robot/ik/joints";

/**
 * Geometric (decoupled) IK for the palletizing arm; robotIK tries it before the numeric solver.
 *
 * Joint order matches robotIK `all`: [hand00 base yaw, hand01 shoulder, hand02 elbow, hand04 wrist pitch, hand03 roll].
 * hand01/hand02/hand04 have parallel axes, so the arm is planar: hand00 only aims that plane at the target
 * (facing it, or the opposite way so the arm reaches backward), then a 2-link law-of-cosines solve places
 * hand04 so the tool (hand04 -> GripPoint) points along the required pitch. hand03 (box roll) is left to the
 * caller; it is locked in the current robot settings.
 *
 * Link lengths, offsets, axis signs and zero positions are read from the robot hierarchy once (at the pose the
 * controls hold when created), so the solve stays exact for any scale or export convention as long as the three
 * pitch axes stay parallel and perpendicular to the base axis (checked; otherwise `create` throws).
 */
export type AnalyticSolution = {
  angles: number[];
  /** Tool point on the side hand00 faces (radial > 0) or reached backward over the base (radial < 0). */
  front: boolean;
  /** Elbow bend sign in the arm plane; +1/-1 match the two law-of-cosines branches. */
  elbow: 1 | -1;
  /** Sum of |joint change| from `current` (rad), hand00 counted the short way. */
  travel: number;
  /** Tool pitch actually used (differs from the request only with `adjustPitch`). */
  pitch: number;
};
export type AnalyticOptions = {
  /** In-plane absolute tool direction (rad): -PI/2 = suction pointing straight down (default). */
  pitch?: number;
  /** Prefer keeping the current elbow configuration (default true). */
  keepElbow?: boolean;
  /** Reject solutions whose wrist is beyond this fraction of full arm reach (keeps away from the straight-elbow singularity). */
  maxReachRatio?: number;
  /**
   * With maxReachRatio: instead of rejecting a too-far wrist, turn the tool (continuously) to the nearest pitch
   * that puts the wrist exactly on the reach limit. The pitch used is returned in `AnalyticSolution.pitch`.
   */
  adjustPitch?: boolean;
  /** With adjustPitch: start easing the wrist toward the limit from this reach fraction (C1-smooth, no corner). */
  softReachStart?: number;
};

const TURN = 2 * Math.PI;
const wrap = (angle: number) => angle - TURN * Math.round(angle / TURN);
const AXIS_TOLERANCE = 1e-4;

type Vec2 = [number, number];
const angleOf = (v: Vec2) => Math.atan2(v[1], v[0]);
const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

/** World positions/axes of each control and the tip for given joint angles (same chain walk as robotKinematics). */
function createChain(controls: JointControl[], tip: Object3D) {
  const nodes: Object3D[] = [];
  for (let node: Object3D | null = tip; node; node = node.parent) nodes.unshift(node);
  const links = nodes.map((node) => ({
    position: node.position.clone(), scale: node.scale.clone(), rotation: node.quaternion.clone(),
    index: controls.findIndex((control) => control.node === node),
  }));
  const matrix = new Matrix4(), local = new Matrix4(), rotation = new Quaternion(), turn = new Quaternion();
  return (angles: number[]) => {
    const positions: Vector3[] = [], axes: Vector3[] = [];
    matrix.identity();
    for (const link of links) {
      const control = controls[link.index];
      rotation.copy(link.rotation);
      if (control) rotation.copy(control.rest).multiply(turn.setFromAxisAngle(control.axis, angles[link.index] - control.initialX));
      matrix.multiply(local.compose(link.position, rotation, link.scale));
      if (control) {
        positions[link.index] = new Vector3().setFromMatrixPosition(matrix);
        axes[link.index] = control.axis.clone().transformDirection(matrix).normalize();
      }
    }
    return { positions, axes, tip: new Vector3().setFromMatrixPosition(matrix) };
  };
}

/** `value` shifted by whole turns to the equivalent nearest `current` inside [min, max]; null if none fits. */
function nearestWithin(value: number, current: number, min: number, max: number) {
  let best: number | null = null;
  const k0 = Math.round((current - value) / TURN);
  for (const k of [k0 - 1, k0, k0 + 1]) {
    const candidate = value + k * TURN;
    if (candidate < min - 1e-9 || candidate > max + 1e-9) continue;
    if (best === null || Math.abs(candidate - current) < Math.abs(best - current)) best = candidate;
  }
  return best;
}

export function createAnalyticIK(all: JointControl[], tip: Object3D) {
  if (all.length !== 5) throw new Error("Analytic IK expects [hand00, hand01, hand02, hand04, hand03]");
  const chain = createChain(all, tip);
  const reference = all.map((control) => control.angle);
  const { positions, axes, tip: tipPosition } = chain(reference);
  const origin = positions[0].clone(), up = axes[0].clone();
  const normal = axes[1].clone();
  if (Math.abs(normal.dot(up)) > AXIS_TOLERANCE) throw new Error("hand01 axis is not perpendicular to hand00");
  const signs = [1, 2, 3].map((i) => {
    const dot = axes[i].dot(normal);
    if (Math.abs(Math.abs(dot) - 1) > AXIS_TOLERANCE) throw new Error(`Joint ${all[i].node.name} is not parallel to hand01`);
    return Math.sign(dot);
  });
  // (radial, up, normal) is right-handed: +rotation about `normal` turns radial toward up.
  const radial = up.clone().cross(normal).normalize();
  const plane = (point: Vector3): Vec2 => {
    const d = point.clone().sub(origin);
    return [d.dot(radial), d.dot(up)];
  };
  const shoulder = plane(positions[1]), elbowPoint = plane(positions[2]), wristPoint = plane(positions[3]), toolPoint = plane(tipPosition);
  const lateral = tipPosition.clone().sub(origin).dot(normal);
  const upper = sub2(elbowPoint, shoulder), fore = sub2(wristPoint, elbowPoint), tool = sub2(toolPoint, wristPoint);
  const lengths = [Math.hypot(...upper), Math.hypot(...fore), Math.hypot(...tool)];
  const phases = [angleOf(upper), angleOf(fore), angleOf(tool)];
  const elbowSign = (angles: number[]) => (Math.sign(wrap(signs[1] * (angles[2] - reference[2]) + phases[1] - phases[0])) || 1) as 1 | -1;

  function solve(target: Vector3, current: number[], options: AnalyticOptions = {}): AnalyticSolution[] {
    const requested = options.pitch ?? -Math.PI / 2;
    const d = target.clone().sub(origin), height = d.dot(up);
    const a = d.dot(normal), b = d.dot(radial), rho = Math.hypot(a, b);
    if (rho < Math.abs(lateral) - 1e-12) return [];
    // Base turn Δ (from the reference pose): the turned plane must hold the tool's lateral offset.
    const spread = Math.acos(Math.min(1, Math.max(-1, lateral / Math.max(rho, 1e-12)))), phase = Math.atan2(b, a);
    const solutions: AnalyticSolution[] = [];
    const currentElbow = elbowSign(current);
    for (const turn of spread < 1e-12 ? [phase] : [phase + spread, phase - spread]) {
      const reach = b * Math.cos(turn) - a * Math.sin(turn);
      const [l1, l2, l3] = lengths, limit = (l1 + l2) * (options.maxReachRatio ?? 1);
      let pitch = requested;
      let wrist: Vec2 = [reach - l3 * Math.cos(pitch), height - l3 * Math.sin(pitch)];
      const soft = (l1 + l2) * Math.min(options.softReachStart ?? 1, options.maxReachRatio ?? 1), free = Math.hypot(...sub2(wrist, shoulder));
      if (options.adjustPitch && free > Math.min(soft, limit)) {
        // Eased wrist distance: identity below `soft`, then a tanh knee that approaches `limit` without a corner.
        const span = limit - soft, goal = span > 1e-9 ? soft + span * Math.tanh((free - soft) / span) : limit;
        // |D - l3*u(p)| = limit  =>  cos(p - phi) = (|D|^2 + l3^2 - limit^2) / (2*l3*|D|), D = tool point - shoulder.
        const D = sub2([reach, height], shoulder), size = Math.hypot(...D);
        const c = (size * size + l3 * l3 - goal * goal) / (2 * l3 * Math.max(size, 1e-12));
        if (Math.abs(c) <= 1) {
          const phi = angleOf(D), spreadP = Math.acos(c);
          const options2 = [phi + spreadP, phi - spreadP].map(value => requested + wrap(value - requested));
          pitch = Math.abs(options2[0] - requested) <= Math.abs(options2[1] - requested) ? options2[0] : options2[1];
          wrist = [reach - l3 * Math.cos(pitch), height - l3 * Math.sin(pitch)];
        }
      }
      const toWrist = sub2(wrist, shoulder), distance = Math.hypot(...toWrist);
      if (distance > limit + 1e-9 || distance < Math.abs(l1 - l2) - 1e-9 || distance < 1e-12) continue;
      const bend = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance))));
      for (const elbow of bend < 1e-9 ? [1 as const] : [1 as const, -1 as const]) {
        const a1 = angleOf(toWrist) + elbow * bend;
        const elbowAt: Vec2 = [shoulder[0] + l1 * Math.cos(a1), shoulder[1] + l1 * Math.sin(a1)];
        const a2 = angleOf(sub2(wrist, elbowAt));
        const d1 = wrap(a1 - phases[0]), d2 = wrap(a2 - phases[1]), d3 = wrap(pitch - phases[2]);
        const raw = [
          reference[0] + turn,
          reference[1] + signs[0] * d1,
          reference[2] + signs[1] * (d2 - d1),
          reference[3] + signs[2] * (d3 - d2),
        ];
        const angles: number[] = [];
        let valid = true;
        for (let i = 0; i < 4 && valid; i++) {
          const value = nearestWithin(raw[i], current[i], all[i].min, all[i].max);
          if (value === null) valid = false;
          else angles.push(value);
        }
        if (!valid) continue;
        angles.push(current[4]);
        const travel = angles.reduce((sum, value, i) => sum + Math.abs(value - current[i]), 0);
        solutions.push({ angles, front: reach >= 0, elbow: elbowSign(angles), travel, pitch });
      }
    }
    const keep = options.keepElbow ?? true;
    return solutions.sort((x, y) =>
      (keep ? Number(x.elbow !== currentElbow) - Number(y.elbow !== currentElbow) : 0) || x.travel - y.travel);
  }

  /** In-plane absolute angles of upper arm, forearm and tool for joint values (inverse of the solve mapping). */
  function linkAngles(angles: number[]) {
    const d1 = signs[0] * (angles[1] - reference[1]);
    const d2 = signs[1] * (angles[2] - reference[2]) + d1;
    const d3 = signs[2] * (angles[3] - reference[3]) + d2;
    return [phases[0] + d1, phases[1] + d2, phases[2] + d3];
  }
  /** Current in-plane tool direction (same convention as `AnalyticOptions.pitch`). */
  const pitchOf = (angles: number[]) => wrap(linkAngles(angles)[2]);
  /** Which solution branch a joint configuration is on (facing/backward, elbow sign). */
  function branchOf(angles: number[]) {
    const [a1, a2, a3] = linkAngles(angles);
    const reach = shoulder[0] + lengths[0] * Math.cos(a1) + lengths[1] * Math.cos(a2) + lengths[2] * Math.cos(a3);
    return { front: reach >= 0, elbow: elbowSign(angles) };
  }

  return {
    solve, pitchOf, branchOf,
    /** Shoulder-to-wrist distance as a fraction of full arm reach. */
    reachRatioOf: (angles: number[]) => { const [a1, a2] = linkAngles(angles); return Math.hypot(lengths[0] * Math.cos(a1) + lengths[1] * Math.cos(a2), lengths[0] * Math.sin(a1) + lengths[1] * Math.sin(a2)) / (lengths[0] + lengths[1]); },
    /** Planar geometry read from the model (model units), for diagnostics. */
    geometry: { lengths, lateral, shoulder, signs, phases },
  };
}
