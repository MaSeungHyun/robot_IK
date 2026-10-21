import { Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import type { IKPose } from "@/domain/robot/ik/robotIK";

/** Bump when the robot model, joint limits or carry-plan shape changes so stale entries never match. */
const MODEL_VERSION = 1;
const LIMIT = 2048;
const mm = (value: number) => Math.round(value * 1000);

/**
 * Carry-side (pallet) plans keyed by everything that shapes them: robot base pose and reach,
 * slot destination (encodes pallet pose, box size, packing pattern and gap), box yaw,
 * transfer mode, phase and model version. Playback still validates every sample, so a stale
 * hit only falls back to live planning.
 */
const entries = new Map<string, IKPose>();
const stats = { hits: 0, misses: 0, stored: 0, invalidated: 0, rejected: 0 };
const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();

export function placePoseKey(robot: Object3D, reach: number, destination: Vector3, yaw: number, mode: string, phase: string) {
  robot.matrixWorld.decompose(position, rotation, scale);
  const heading = Math.atan2(2 * (rotation.w * rotation.y + rotation.x * rotation.z), 1 - 2 * (rotation.y ** 2 + rotation.z ** 2));
  return [MODEL_VERSION, mode, phase, mm(position.x), mm(position.y), mm(position.z), Math.round(heading * 1e4), mm(scale.x), mm(reach),
    mm(destination.x), mm(destination.y), mm(destination.z), Math.round(yaw * 1e4)].join("|");
}

const copy = (pose: IKPose): IKPose => ({
  ...pose,
  angles: [...pose.angles],
  route: pose.route?.map((step) => ({ ...step, angles: [...step.angles] })),
  step: pose.route ? 0 : undefined,
  target: pose.target?.clone(),
  alignment: undefined,
  transit: undefined,
});

const TURN = 2 * Math.PI;
const wrap = (angle: number) => angle - TURN * Math.round(angle / TURN);
/** Extra joint travel (rad) a stored plan may need beyond the direct move; more means a detour or branch change. */
const DETOUR_LIMIT = { base: (10 * Math.PI) / 180, arm: (15 * Math.PI) / 180 };

/** Arm (hand01/02/04/03) change (rad) beyond which a stored goal is another posture than a fresh solve from here would pick. */
const ARM_REUSE = (60 * Math.PI) / 180;

type JointState = { baseYaw: number; angles: readonly number[] };

/**
 * Stored plan for `key`, re-expressed for the robot's current joints: hand00 is continuous, so the
 * plan is shifted by whole turns to start on the current winding (no replayed extra turns). A plan
 * whose hand00 or arm travel from here exceeds the direct move by DETOUR_LIMIT is rejected (miss).
 */
export function lookupPlacePose(key: string, current: JointState): IKPose | null {
  const stored = entries.get(key);
  if (!stored) {
    stats.misses++;
    return null;
  }
  // Waypoint routes were shaped around the recorded start pose; only a direct goal transfers to a new start.
  if (stored.route) {
    stats.misses++;
    stats.rejected++;
    return null;
  }
  const pose = copy(stored);
  const steps: JointState[] = pose.route ?? [pose];
  const shift = TURN * Math.round((current.baseYaw - steps[0].baseYaw) / TURN);
  if (shift) {
    for (const step of pose.route ?? []) step.baseYaw += shift;
    pose.baseYaw += shift;
  }
  let base = 0, arm = 0, previous = current;
  for (const step of [...steps, pose]) {
    base += Math.abs(step.baseYaw - previous.baseYaw);
    arm += step.angles.reduce((sum, angle, i) => sum + Math.abs(angle - previous.angles[i]), 0);
    previous = step;
  }
  const directBase = Math.abs(wrap(pose.baseYaw - current.baseYaw));
  const directArm = pose.angles.reduce((sum, angle, i) => sum + Math.abs(angle - current.angles[i]), 0);
  if (base > directBase + DETOUR_LIMIT.base || arm > directArm + DETOUR_LIMIT.arm || directArm > ARM_REUSE) {
    stats.misses++;
    stats.rejected++;
    return null;
  }
  stats.hits++;
  return pose;
}

export function storePlacePose(key: string, pose: IKPose) {
  if (!pose.reachable) return;
  if (entries.size >= LIMIT) entries.delete(entries.keys().next().value!);
  entries.set(key, copy(pose));
  stats.stored++;
}

export function invalidatePlacePose(key: string) {
  if (entries.delete(key)) stats.invalidated++;
}

export function clearPlacePoseCache() {
  entries.clear();
}

export function placePoseCacheStats() {
  return { ...stats, size: entries.size };
}
