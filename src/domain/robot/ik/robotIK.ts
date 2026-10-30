import { IK_CONFIG, MOTION, COLLISION, NUMERICAL_IK, ROBOT_PICKING } from "@/constants/simulation";
import { Box3, Group, MathUtils, Mesh, Quaternion, Vector3, type Object3D } from "three";
import { createCollisionWorld } from "@/domain/robot/ik/collisions";
import { createJointControl, setJointAngle } from "@/domain/robot/ik/joints";
import { createKinematics, solvePosition } from "@/domain/robot/ik/closedChainKinematics";
import { createKinematics as createForwardKinematics, type NumericResult } from "@/domain/robot/ik/robotKinematics";
import { createHeldBoxCollision } from "@/domain/robot/ik/heldBoxCollision";
import { synchronizedTrapezoid, trapezoid } from "@/domain/robot/ik/motionTiming";
import { createAnalyticIK } from "@/domain/robot/ik/analyticIK";
import { insideKeepOut, type KeepOutBox } from "@/domain/robot/ik/keepOut";

type IKStep = { angles: number[]; baseYaw: number };
export type IKPose = IKStep & { error: number; reachable: boolean; reason?: "timeout"; blockedBy?: string; route?: IKStep[]; step?: number; target?: Vector3; alignment?: IKPose; transit?: IKPose };
export type LineLock = { baseYaw: number; pitch: number; origin: number; softReach: number; maxReach: number; front: boolean; elbow: 1 | -1; vertical?: boolean };
type IKConstraints = { baseYaw?: number; wristAbovePoint?: boolean; descentTarget?: Vector3; wristRange?: [number,number]; relaxPickTilt?: boolean };

/**
 * How plans were solved (process-wide, diagnostics only): analytic = strict vertical tool, tilt = analytic with a
 * small tool pitch tolerance, numeric = seeded numeric IK, rrt = joint-space detour, failed = no plan.
 * cartesianAnalytic / cartesianNumeric count individual straight-line (MoveL) waypoints.
 */
export const ikSolveStats = { beltClipRejected: 0, analytic: 0, tilt: 0, numeric: 0, rrt: 0, failed: 0, cartesianAnalytic: 0, cartesianNumeric: 0, line: 0, lineNoSolution: 0, lineBlocked: 0, verticalFallback: 0, levelCompensated: 0, levelFallback: 0, elbowRaised: 0 };
export function resetIKSolveStats() { for (const key of Object.keys(ikSolveStats) as (keyof typeof ikSolveStats)[]) ikSolveStats[key] = 0; }
/** Analytic tool pitch sweep (degrees off vertical), strict first. */
const ANALYTIC_TILT_DEGREES = [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15, 18, -18, 20, -20];
/** Largest single-joint change (rad) accepted for one analytic MoveL waypoint; bigger means a branch flip. */
const ANALYTIC_STEP_CONTINUITY = 0.35;
/** Straight segments keep the wrist inside this fraction of full reach; beyond it the tool tilts instead. */
const LINE_MAX_REACH = 0.97;
/** Tool starts tilting (smoothly) once the wrist passes this fraction of full reach. */
const LINE_SOFT_REACH = 0.88;
/** Candidate ranking extras (s of equivalent joint travel): per degree of tool tilt, and for leaving the current branch. */
const ANALYTIC_TILT_COST = IK_CONFIG.toolTiltCostPerDegree;
const ANALYTIC_BRANCH_COST = 0.6;
/** Posture ranking (s equivalent): stay this far from finite joint stops, and away from the stretched/folded elbow. */
const LIMIT_MARGIN = MathUtils.degToRad(10);
const LIMIT_MARGIN_COST = 0.3;
const STRETCHED_REACH = 0.9;
const FOLDED_REACH = 0.15;
const SINGULARITY_COST = 3;
/** RRT shortcut: farthest-first attempts per waypoint when pruning a found detour. */
const SHORTCUT_ATTEMPTS = 8;
/** Largest single-joint change (rad) accepted per tracking update of a moving pickup (hand00 included). */
const TRACK_STEP_CONTINUITY = 0.6;

/** Tool tip (suction point): the `RobotArm_point` Empty (any case), or legacy `GripPoint`. */
export function findGripPoint(model: Object3D): Object3D | undefined {
  let found: Object3D | undefined;
  model.traverse(node => { if (!found && /^(robotarm_point|grippoint)$/i.test(node.name)) found = node; });
  return found;
}

export function createRobotIK(model: Group, collisionMode: "world" | "held-box-hand03" | "none" = "world") {
  const grip = findGripPoint(model)!;
  const wrist = model.getObjectByName("hand04")!;
  const baseNode = model.getObjectByName("hand00")!;
  if (!grip || !wrist || !baseNode) throw new Error("Robot is missing its tool or base joint");
  const controls = [1, 2, 4, 3].map(i => {
    const node = model.getObjectByName("hand0" + i);
    if (!node) throw new Error("Robot joint missing: hand0" + i);
    return createJointControl(node);
  });
  const baseControl = createJointControl(baseNode);
  const all = [baseControl, ...controls];
  for (const control of all) setJointAngle(control, control.angle);
  model.updateWorldMatrix(true, true);
  // Geometry is read once at the export pose; models that break the planar-arm assumptions use numeric IK only.
  let analytic: ReturnType<typeof createAnalyticIK> | null = null;
  try { analytic = createAnalyticIK(all, grip); } catch { analytic = null; }
  const shaft = grip.getWorldPosition(new Vector3()).sub(wrist.getWorldPosition(new Vector3())).normalize();
  const downRotation = new Quaternion().setFromUnitVectors(shaft, new Vector3(0, -1, 0));
  const upright = downRotation.multiply(grip.getWorldQuaternion(new Quaternion()));
  const carryRotation = upright.clone().invert();
  const collisionDisabled = collisionMode === "none";
  const WRIST_FULL_TURN = "hand04 한 바퀴 우회 회전 금지";
  const BASE_FULL_TURN = "hand00 한 바퀴 이상 회전 금지";
  // hand00 has no stops. The opposite (long) base turn is only worth trying when the
  // short turn is substantial; otherwise it is a near-full spin in place.
  const MIN_SHORT_BASE_TURN = Math.PI / 4;
  if (collisionDisabled) {
    const control=controls[2];
    control.min=control.initialX+MathUtils.degToRad(IK_CONFIG.wristTravelDegrees[0]);
    control.max=control.initialX+MathUtils.degToRad(IK_CONFIG.wristTravelDegrees[1]);
  }
  const heldBoxOnly = collisionMode !== "world";
  const payloadCollision = heldBoxOnly ? createHeldBoxCollision(model, grip) : null;
  const collisions = payloadCollision ?? Object.assign(
    createCollisionWorld(model, grip), { setHeld: (box: Group | null) => { void box; } },
  );
  const armMeshes: Mesh[] = [];
  model.traverse(node => {
    if (!(node instanceof Mesh)) return;
    let part: Object3D = node;
    while (part.parent && !/^hand0[1-5]$/.test(part.name)) part = part.parent;
    if (/^hand0[2-5]$/.test(part.name)) { node.geometry.computeBoundingBox(); armMeshes.push(node); }
  });
  const bounds = new Box3();
  const toolPoint = new Vector3();
  const shoulderPoint = new Vector3();
  const elbowPoint = new Vector3();
  let minimumToolHeight: number | null = null;
  let lastMotionBlock: string | null = null;
  let blockedWristDirection = 0;
  let blockedBaseDirection = 0;
  /** Pickup contact phases relax the upper-arm elevation rule (IK_CONFIG.contactShoulderMinimumElevationDegrees). */
  let contactMode = false;
  let toolLevel = false;
  /**
   * Upper-arm elevation (rad) of the real arm at the start of its last motion step. Outside contact phases the
   * elevation rule never forbids staying at/above where the arm already is, so an arm that dipped below
   * horizontal during pickup can still plan out of it (and never deeper); it tightens back as the arm rises.
   */
  let realElevation = Infinity;
  let elbowBelowShoulder = false;
  controls[1].node.traverseAncestors((node) => { if (node === controls[0].node) elbowBelowShoulder = true; });
  const shoulderElevation = () => {
    // The elbow joint is below the shoulder in the chain: one parent-chain update refreshes both matrices
    // (getWorldPosition twice walked the chain twice; hot at high playback speed).
    if (elbowBelowShoulder) {
      controls[1].node.updateWorldMatrix(true, false);
      shoulderPoint.setFromMatrixPosition(controls[0].node.matrixWorld); elbowPoint.setFromMatrixPosition(controls[1].node.matrixWorld);
    } else { controls[0].node.getWorldPosition(shoulderPoint); controls[1].node.getWorldPosition(elbowPoint); }
    return Math.atan2(elbowPoint.y - shoulderPoint.y, Math.hypot(elbowPoint.x - shoulderPoint.x, elbowPoint.z - shoulderPoint.z));
  };
  const read = () => all.map(control => control.angle);
  const pack = (values: number[]): IKStep => ({ baseYaw: values[0], angles: values.slice(1) });
  const unpack = (pose: IKStep) => [pose.baseYaw, ...pose.angles];
  const tiltTolerance = () => MathUtils.degToRad(heldBoxOnly && controls[3].locked
    ? IK_CONFIG.lockedRollTiltToleranceDegrees : IK_CONFIG.placementWorldTiltToleranceDegrees);
  const jointTurn = new Quaternion();
  /** Joint angles only (same clamp/rotation as setJointAngle), without the per-joint subtree matrix update. */
  function setAngles(values: number[]) {
    for (let i = 0; i < all.length; i++) {
      const control = all[i];
      control.angle = MathUtils.clamp(values[i], control.min, control.max);
      control.node.quaternion.copy(control.rest).multiply(jointTurn.setFromAxisAngle(control.axis, control.angle - control.initialX));
    }
  }
  function apply(values: number[]) {
    setAngles(values);
    model.updateWorldMatrix(true, true);
    collisions.syncHeld();
  }
  /**
   * Sample pose for planning/motion checks. Held-box/none modes only read world positions along the grip chain
   * (getWorldPosition refreshes parents itself) and the held box, so only that chain is updated instead of the
   * whole robot subtree. World-collision mode needs every arm mesh matrix and uses the full update.
   */
  function applySample(values: number[]) {
    if (!heldBoxOnly) { apply(values); return; }
    setAngles(values);
    grip.updateWorldMatrix(true, false);
  }
  /** Collision samples since the last planning yield (shared by every edge check of this robot). */
  let sampleWork = 0;
  function violation(values: number[], planning = false) {
    if (values.some((value, i) => !Number.isFinite(value) || value < all[i].min - 1e-9 || value > all[i].max + 1e-9)) return "관절 각도 제한 초과";
    const elevationLimit = contactMode ? MathUtils.degToRad(IK_CONFIG.contactShoulderMinimumElevationDegrees)
      : Math.min(MathUtils.degToRad(IK_CONFIG.shoulderMinimumElevationDegrees), realElevation - 1e-6);
    if (shoulderElevation() < elevationLimit - 1e-9) return "hand01 상완 하향 자세 · 팔레트/컨베이어 간섭 위험";
    if (minimumToolHeight!==null && grip.getWorldPosition(toolPoint).y<minimumToolHeight-MOTION.contactTolerance) return "이송 경유 높이 미만";
    if (payloadCollision && !payloadCollision.isWristAboveHeld()) return "들어 올리는 동안 hand04가 박스 위에 있어야 합니다.";
    const collision = collisionDisabled ? null : heldBoxOnly ? collisions.collision() : collisions.collision(planning ? NUMERICAL_IK.planningArmClearance : 0);
    if (collision) return collision;
    if (!heldBoxOnly) for (const mesh of armMeshes) if (bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).min.y < COLLISION.floorClearance) return "관절이 바닥 여유를 침범";
    return null;
  }
  // Every sampled pose is restored before yielding; planning is invisible.
  function* edge(from: number[], to: number[], limits?: [number,number][]): Generator<void, string | null, void> {
    if (collisionDisabled && Math.abs(to[3]-from[3])>Math.PI+1e-8) return WRIST_FULL_TURN;
    // Never plan a base move of a full turn or more (multi-turn spin in place).
    if (Math.abs(to[0]-from[0]) >= 2*Math.PI-1e-8) return BASE_FULL_TURN;
    const saved = read();
    let duration = 0, samples = 1;
    for (let i = 0; i < to.length; i++) {
      const change = Math.abs(to[i] - from[i]);
      duration = Math.max(duration, change / (i === 0 ? MOTION.baseAngularSpeed : MOTION.angularSpeed));
      samples = Math.max(samples, Math.ceil(change / NUMERICAL_IK.planningAngularSample));
    }
    samples = Math.max(samples, Math.ceil(duration * IK_CONFIG.pathSamplesPerSecond));
    const values = new Array<number>(from.length);
    // Belt keep-out only when the move starts clear: a pose already through a conveyor may always move out.
    const beltCheck = !clipsBelt(from);
    if (beltCheck && clipsBelt(to)) { ikSolveStats.beltClipRejected++; return BELT_CLIP; }
    try {
      for (let sample = 0; sample <= samples; sample++) {
        for (let i = 0; i < from.length; i++) values[i] = MathUtils.lerp(from[i], to[i], sample / samples);
        applySample(values);
        if (limits && values.some((value,i) => (limits[i][0]===limits[i][1] || Number.isFinite(all[i].min))
          && (value < limits[i][0]-1e-8 || value > limits[i][1]+1e-8))) return "단계별 관절 고정 범위 초과";
        const hit = violation(values,true);
        if (hit) return hit;
        if (beltCheck && clipsBeltNow()) return BELT_CLIP;
        // Yield by accumulated work, not per edge: chains of short or early-failing edges also get sliced.
        if (++sampleWork >= IK_CONFIG.collisionSamplesPerSlice) { sampleWork = 0; apply(saved); yield; }
      }
      return null;
    } finally { apply(saved); }
  }
  // Collision-free robots bound hand04 to one turn of travel and refuse any move
  // longer than half a turn. Keep IK solutions inside that half turn so the
  // planner returns the short rotation instead of a long one that edge() rejects.
  function withinHalfTurn(limits: [number, number][], reference: number[]): [number, number][] {
    if (!collisionDisabled) return limits;
    const [min, max] = limits[3];
    if (min === max) return limits;
    const low = Math.max(min, reference[3] - Math.PI), high = Math.min(max, reference[3] + Math.PI);
    if (low > high) return limits;
    return limits.map((range, i) => i === 3 ? [low, high] : range);
  }
  function limitsAround(start: number[], constraints?: IKConstraints): [number, number][] {
    return all.map((control, i) => i === 3 && constraints?.wristRange ? constraints.wristRange : i === 0 && constraints?.baseYaw !== undefined ? [constraints.baseYaw,constraints.baseYaw] : control.locked ? [control.angle, control.angle] : [
      Number.isFinite(control.min) ? control.min : start[i] - Math.PI,
      Number.isFinite(control.max) ? control.max : start[i] + Math.PI,
    ]);
  }
  const nearest = (value: number, reference: number) => reference + Math.atan2(Math.sin(value-reference), Math.cos(value-reference));
  /** Time-weighted joint travel (s): hand00 is slower, so its turns cost more. */
  const travelCost = (from: number[], to: number[]) => to.reduce((sum, value, i) =>
    sum + Math.abs(value - from[i]) / (i === 0 ? MOTION.baseAngularSpeed : MOTION.angularSpeed), 0);
  /**
   * Closed-form candidates: hand00 aims the arm plane (facing or reaching backward), hand01/02 by law of cosines,
   * hand04 = pitch - (q1+q2). `plan` sweeps the tool pitch (vertical, then up to ANALYTIC sweep tilt, plus the
   * current tilt when allowed); `step` (MoveL waypoint) keeps the current tool pitch so the orientation is held.
   * Candidates respect `limits` (fixed hand00, wrist range, locked joints), are FK-checked, and are ordered by
   * time-weighted joint travel plus a small tilt cost and a branch-change cost (hysteresis for tracking re-plans).
   */
  /** Extra ranking cost for postures near finite joint stops or the stretched/folded elbow singularities. */
  function postureCost(angles: number[]) {
    let cost = 0;
    for (let i = 0; i < all.length; i++) {
      const control = all[i];
      if (control.locked || !Number.isFinite(control.min) || !Number.isFinite(control.max)) continue;
      const margin = Math.min(angles[i] - control.min, control.max - angles[i]);
      if (margin < LIMIT_MARGIN) cost += LIMIT_MARGIN_COST * (1 - Math.max(0, margin) / LIMIT_MARGIN);
    }
    if (analytic) {
      const ratio = analytic.reachRatioOf(angles);
      if (ratio > STRETCHED_REACH) cost += SINGULARITY_COST * (ratio - STRETCHED_REACH);
      if (ratio < FOLDED_REACH) cost += SINGULARITY_COST * (FOLDED_REACH - ratio);
    }
    return cost;
  }
  function analyticCandidates(...args: Parameters<typeof analyticSearch>) {
    const search = analyticSearch(...args);
    for (;;) { const next = search.next(); if (next.done) return next.value; }
  }
  /** analyticCandidates, yielding after each tool pitch so a full sweep is spread over planning slices. */
  function* analyticSearch(start: number[], target: Vector3, limits: [number,number][], maxTiltDegrees: number, forward: ReturnType<typeof createKinematics>["forward"], mode: "plan" | "step" = "plan"): Generator<void, { angles: number[]; tilt: number; cost: number }[], void> {
    const found: { angles: number[]; tilt: number; cost: number }[] = [];
    if (!analytic) return found;
    const vertical = -Math.PI / 2, tiltOf = (pitch: number) => Math.abs(MathUtils.radToDeg(nearest(pitch, vertical) - vertical));
    const current = analytic.pitchOf(start), currentTilt = tiltOf(current);
    const sweep = Math.min(maxTiltDegrees, IK_CONFIG.analyticMaxTiltDegrees);
    const clamped = vertical + MathUtils.degToRad(Math.sign(nearest(current, vertical) - vertical) * Math.min(currentTilt, maxTiltDegrees));
    const pitches = mode === "step" ? [currentTilt <= maxTiltDegrees + 1e-6 ? current : clamped]
      : [...ANALYTIC_TILT_DEGREES.filter(t => Math.abs(t) <= sweep + 1e-9).map(t => vertical + MathUtils.degToRad(t)),
        ...(currentTilt > 0.5 && currentTilt <= maxTiltDegrees + 1e-6 ? [current] : [])];
    const branch = analytic.branchOf(start);
    for (const pitch of pitches) {
      for (const solution of analytic.solve(target, start, { pitch, keepElbow: false, maxReachRatio: LINE_MAX_REACH })) {
        const angles = solution.angles;
        if (limits[0][0] === limits[0][1]) {
          if (Math.abs(angles[0] - limits[0][0]) > 2e-3) continue;
          angles[0] = limits[0][0];
        }
        if (all[4].locked) angles[4] = start[4];
        if (angles.some((value, i) => value < limits[i][0] - 1e-8 || value > limits[i][1] + 1e-8)) continue;
        if (forward(angles).position.distanceTo(target) > NUMERICAL_IK.positionTolerance) continue;
        if (found.some(other => other.angles.every((v, i) => Math.abs(v - angles[i]) < 1e-3))) continue;
        const tilt = tiltOf(pitch);
        const cost = travelCost(start, angles) + ANALYTIC_TILT_COST * tilt + postureCost(angles)
          + (solution.front !== branch.front ? ANALYTIC_BRANCH_COST : 0) + (solution.elbow !== branch.elbow ? ANALYTIC_BRANCH_COST / 2 : 0)
          + (clipsBelt(angles) ? IK_CONFIG.beltClipCost : 0);
        found.push({ angles, tilt, cost });
      }
      if (mode === "plan") yield;
    }
    return found.sort((a, b) => a.cost - b.cost);
  }
  const analyticTiltLimit = (downward: boolean) => downward ? MathUtils.radToDeg(tiltTolerance()) : 90;
  const TILT_CAP = MathUtils.degToRad(IK_CONFIG.toolTiltFallbackCapDegrees), VERTICAL = -Math.PI / 2;
  const PICK_TILT_CAP = MathUtils.degToRad(IK_CONFIG.pickTiltCapDegrees);
  const tiltFromVertical = (pitch: number) => Math.abs(Math.atan2(Math.sin(pitch - VERTICAL), Math.cos(pitch - VERTICAL)));
  /** Lock pitch turned back toward vertical by a small step (line/track keep the suction face down). */
  const towardVertical = (pitch: number) => { const d = Math.atan2(Math.sin(VERTICAL - pitch), Math.cos(VERTICAL - pitch)), s = MathUtils.degToRad(IK_CONFIG.toolTiltRecoverDegreesPerStep); return Math.abs(d) > TILT_CAP ? pitch : Math.abs(d) <= s ? VERTICAL : pitch + Math.sign(d) * s; };
  /** PLACE: step toward world vertical with no cap (IK_CONFIG.placeVerticalRecoverDegreesPerStep). */
  const stepToVertical = (pitch: number) => { const d = Math.atan2(Math.sin(VERTICAL - pitch), Math.cos(VERTICAL - pitch)), s = MathUtils.degToRad(IK_CONFIG.placeVerticalRecoverDegreesPerStep); return Math.abs(d) <= s ? VERTICAL : pitch + Math.sign(d) * s; };
  function makeSeeds(start: number[], target: Vector3, forward: ReturnType<typeof createKinematics>["forward"]) {
    const pivot = baseNode.getWorldPosition(new Vector3());
    const source = forward(start).position.sub(pivot), destination = target.clone().sub(pivot);
    const yaw = start[0] + Math.atan2(-destination.z,destination.x) - Math.atan2(-source.z,source.x);
    const yawNear = nearest(yaw, start[0]);
    const seeds = [[...start], [yawNear, ...start.slice(1)]];
    // A reversed full turn has the same final posture. Also solve genuinely opposite wrist postures.
    if(payloadCollision?.holding)for(const flip of [-Math.PI,Math.PI]){
      seeds.push([yawNear,start[1],start[2],start[3]+flip,start[4]]);
      seeds.push([yawNear,start[1],nearest(-start[2],start[2]),start[3]+flip,start[4]]);
    }
    for (const roll of NUMERICAL_IK.seedRollDegrees) {
      for (const a of NUMERICAL_IK.seedShoulderDegrees) for (const b of NUMERICAL_IK.seedElbowDegrees) {
        seeds.push([yawNear, MathUtils.degToRad(a), nearest(MathUtils.degToRad(b),start[2]),
          MathUtils.clamp(start[3] - (MathUtils.degToRad(a)-start[1]) - (nearest(MathUtils.degToRad(b),start[2])-start[2]), controls[2].min, controls[2].max),
          controls[3].locked ? start[4] : nearest(MathUtils.degToRad(roll),start[4])]);
      }
    }
    const opposite=seeds.slice(1).map(seed=>[nearest(seed[0]+Math.PI,start[0]),...seed.slice(1)]);
    return [...seeds,...opposite];
  }
  // Follow a straight tool path using small IK steps before joint-space detours.
  function* cartesianRoute(start: number[], target: Vector3, downward: boolean, forward: ReturnType<typeof createKinematics>["forward"], limits: [number,number][], releaseRange?:readonly[number,number]) {
    const origin = forward(start).position;
    const count = Math.max(1, Math.ceil(origin.distanceTo(target) / NUMERICAL_IK.cartesianStep));
    let before = start;
    const route: IKStep[] = [];
    for (let i = 1; i <= count; i++) {
      const stepLimits = withinHalfTurn(limits, before);
      const point = origin.clone().lerp(target,i/count);
      const closed = releaseRange ? undefined : analyticCandidates(before, point, stepLimits, analyticTiltLimit(downward), forward, "step")
        .find(c => c.angles.every((v, j) => Math.abs(v - before[j]) < ANALYTIC_STEP_CONTINUITY));
      if (closed) {
        const hit=yield* edge(before,closed.angles,limits);
        if(!hit){ikSolveStats.cartesianAnalytic++;before=closed.angles;route.push(pack(before));continue;}
      }
      ikSolveStats.cartesianNumeric++;
      let result = yield* solvePosition(forward, before, stepLimits, origin.clone().lerp(target,i/count), downward,
        NUMERICAL_IK.positionTolerance, tiltTolerance(), i===count?releaseRange:undefined);
      if(!result.converged && i<count) result=yield* solvePosition(forward,before,stepLimits,origin.clone().lerp(target,i/count),false,NUMERICAL_IK.positionTolerance,0);
      if (!result.converged) return {route:null,blockedBy:"직선 경로의 자세 해 미발견 · 오차 "+(result.error*1000).toFixed(1)+"mm"};
      const hit=yield* edge(before,result.angles,limits);
      if(hit)return {route:null,blockedBy:hit};
      before = result.angles; route.push(pack(before));
    }
    return {route,blockedBy:undefined};
  }
  function* descentRoute(...args: Parameters<typeof cartesianRoute>) {
    const height=minimumToolHeight,search=cartesianRoute(...args);
    try {
      for(;;){
        minimumToolHeight=null;const next=search.next();minimumToolHeight=height;
        if(next.done)return next.value;
        yield;
      }
    } finally {minimumToolHeight=height;}
  }
  function* jointRoute(start: number[], destination: number[], limits: [number,number][], iterations = NUMERICAL_IK.routeIterations) {
    // Deterministic RRT with goal bias; only verified edges enter the tree.
    const nodes = [{values:start,parent:-1}];
    let state = 479001599;
    const random = () => { state=(Math.imul(state,1664525)+1013904223)>>>0; return state/4294967296; };
    const distance = (a:number[],b:number[]) => a.reduce((sum,value,i)=>sum+(value-b[i])**2,0);
    for (let iteration=0;iteration<iterations;iteration++) {
      // One RRT extension per slice: nearest-neighbour search grows with the tree, failing edges do not yield.
      if(iteration>0)yield;
      const sample = iteration%4===0 ? destination : limits.map(([min,max])=>MathUtils.lerp(min,max,random()));
      if(payloadCollision?.holding&&iteration%4!==0){
        // Sample shoulder/elbow together with a compensating wrist, keeping cargo below the wrist.
        sample[3]=start[3]-(sample[1]-start[1])-(sample[2]-start[2])+MathUtils.degToRad(20)*(random()-0.5);
      }
      let index=0;
      for(let i=1;i<nodes.length;i++)if(distance(nodes[i].values,sample)<distance(nodes[index].values,sample))index=i;
      const before=nodes[index].values;
      const ratio=Math.min(1,NUMERICAL_IK.routeStep/Math.sqrt(distance(before,sample)));
      const next=before.map((value,i)=>MathUtils.lerp(value,sample[i],ratio));
      if(yield* edge(before,next,limits))continue;
      nodes.push({values:next,parent:index});
      if(yield* edge(next,destination,limits))continue;
      const path=[destination];
      for(let i=nodes.length-1;i>=0;i=nodes[i].parent){path.unshift(nodes[i].values);if(i===0)break;}
      return (yield* shortcut(path,limits)).map(pack);
    }
    return null;
  }
  /**
   * Prune an RRT path (start included) to the fewest verified straight joint segments: from each kept
   * waypoint jump to the farthest later one whose direct sweep is collision-free. Returns the waypoints after start.
   */
  function* shortcut(path: number[][], limits: [number,number][]): Generator<void, number[][], void> {
    const kept: number[][] = [];
    for (let i = 0; i < path.length - 1;) {
      let j = i + 1;
      for (let k = path.length - 1, tries = 0; k > i + 1 && tries < SHORTCUT_ATTEMPTS; k--, tries++) {
        if (!(yield* edge(path[i], path[k], limits))) { j = k; break; }
      }
      kept.push(path[j]);
      i = j;
    }
    return kept;
  }
  /**
   * Closed-chain solver chains are expensive to build, so each robot keeps a small pool. A chain is used by one
   * plan at a time (solvePosition keeps state in it across yields) and returned when that plan finishes or is
   * closed; an abandoned plan simply never returns its chain.
   */
  const kinematicsPool: ReturnType<typeof createKinematics>[] = [];
  /** Forward kinematics only (pure, synchronous): for searches that never run the closed-chain solver. */
  const forwardOnly = createForwardKinematics(all, grip, wrist).forward;
  /** Conveyors the arm links must stay out of (world, static); empty = no check. */
  let keepOut: readonly KeepOutBox[] = [];
  const jointPoints = all.map(() => new Vector3()), linkPoint = new Vector3();
  /** Links hand01-hand02 and hand02-hand04 (all[1..3]) sampled as spheres against the conveyor keep-out. */
  function linksClip(points: Vector3[]) {
    for (let link = 1; link <= 2; link++) for (let s = link === 1 ? 0 : 1; s <= 4; s++)
      if (insideKeepOut(linkPoint.copy(points[link]).lerp(points[link + 1], s / 4), keepOut)) return true;
    return false;
  }
  /** Would `angles` put an arm link through a conveyor (pure FK, no model change). */
  function clipsBelt(angles: number[]) {
    if (!keepOut.length) return false;
    forwardOnly(angles, jointPoints);
    return linksClip(jointPoints);
  }
  /** Same check on the currently applied (sampled) pose, from the joint nodes' world matrices. */
  function clipsBeltNow() {
    if (!keepOut.length) return false;
    for (let i = 1; i <= 3; i++) jointPoints[i].setFromMatrixPosition(all[i].node.matrixWorld);
    return linksClip(jointPoints);
  }
  const BELT_CLIP = "팔 링크가 컨베이어를 통과 · 반대쪽 팔꿈치 자세 필요";
  type PlanArgs = Parameters<typeof planWith> extends [unknown, ...infer Rest] ? Rest : never;
  function* startPlan(...args: PlanArgs): Generator<void, IKPose, void> {
    // Creating the generator does no work; acquiring/building the chain is a slice of its own.
    yield;
    const kinematics = kinematicsPool.pop() ?? createKinematics(all, grip, wrist);
    yield;
    try { return yield* planWith(kinematics, ...args); }
    finally { if (kinematicsPool.length < 4) kinematicsPool.push(kinematics); }
  }
  function* planWith(kinematics: ReturnType<typeof createKinematics>, worldTarget: Vector3, wristAbove = false, tracking = false, sliceSolver = false, fastPlacement = false, toolRotation?:Quaternion, constrainPlacementWrist = false, descentTarget?:Vector3, constraints?:IKConstraints): Generator<void, IKPose, void> {
    void sliceSolver; void fastPlacement;
    // Transport solves position only. Downward tilt is imposed for contact and placement,
    // never an arbitrary yaw/roll quaternion that a five-axis arm cannot always satisfy.
    const downward = wristAbove || constrainPlacementWrist || Boolean(payloadCollision?.holding);
    const start=read(), limits=limitsAround(start,constraints), {forward}=kinematics;
    const allowedTilt=tiltTolerance();
    const releaseRange=constrainPlacementWrist?IK_CONFIG.releaseWorldXDegrees.map(MathUtils.degToRad) as [number,number]:undefined;
    // Explicit lowering/retreat requests follow Cartesian waypoints first.
    if(toolRotation){
      const checked=yield* cartesianRoute(start,worldTarget,downward,forward,limits,releaseRange);
      if(checked.route){const route=checked.route,end=route.at(-1)!;return {...end,error:forward(unpack(end)).position.distanceTo(worldTarget),reachable:true,route,step:0};}
      // The straight descent can be blocked by a posture rule (e.g. the upper arm
      // pitching down) even when another joint configuration reaches the same
      // point safely. Fall through to the seeded search below instead of
      // declaring the target unreachable and stalling the phase forever.
    }
    // 1) Closed-form IK: strict vertical tool, then small tilt. Verified like numeric results.
    const analyticBlocked:NumericResult[]=[];
    const closedForm=releaseRange?[]:yield* analyticSearch(start,worldTarget,limits,analyticTiltLimit(downward),forward);
    for(const candidate of closedForm.slice(0,6)){
      if(constraints?.wristAbovePoint&&forward(candidate.angles).wristPosition.y<worldTarget.y+MOTION.contactTolerance)continue;
      if(yield* edge(candidate.angles,candidate.angles,limits))continue;
      if(descentTarget&&!(yield* descentRoute(candidate.angles,descentTarget,downward,forward,limits,releaseRange)).route)continue;
      const hit=yield* edge(start,candidate.angles,limits);
      if(!hit){ikSolveStats[candidate.tilt>0.5?"tilt":"analytic"]++;if(candidate.tilt>0.5)ikSolveStats.verticalFallback++;return {...pack(candidate.angles),error:forward(candidate.angles).position.distanceTo(worldTarget),reachable:true};}
      analyticBlocked.push({angles:candidate.angles,error:0,tilt:0,converged:true});
    }
    // 2) Seeded numeric IK.
    const seeds=makeSeeds(start,worldTarget,forward);
    let best:NumericResult={angles:start,error:Infinity,tilt:Infinity,converged:false};
    let firstHit:string|null=null, skippedTilted=false;
    const candidates:NumericResult[]=[];
    // Pick poses: a numeric solve may lean the cup far off vertical (up to the locked-roll tolerance).
    // Such poses are used only when no near-vertical pose has a free path (second pass, relaxPickTilt).
    const pickTilted=(angles:number[])=>Boolean(constraints?.wristAbovePoint&&!tracking&&!constraints.relaxPickTilt&&analytic&&tiltFromVertical(analytic.pitchOf(angles))>PICK_TILT_CAP);
    // Cheap position-only solve gives a distinct diagnostic, not a false reach verdict.
    const position=yield* solvePosition(forward,start,limits,worldTarget,false,NUMERICAL_IK.positionTolerance,allowedTilt);
    if (!downward && position.converged) seeds.unshift(position.angles);
    for (const seed of seeds) {
      const result=yield* solvePosition(forward,seed,limits,worldTarget,downward,NUMERICAL_IK.positionTolerance,allowedTilt,releaseRange);
      if(result.error<best.error)best=result;
      if(!result.converged)continue;
      if (constraints?.wristAbovePoint && forward(result.angles).wristPosition.y < worldTarget.y + MOTION.contactTolerance) {
        firstHit ??= "hand04가 집기 포인트 위에 있어야 합니다.";
        continue;
      }
      if(candidates.some(c=>c.angles.every((v,i)=>Math.abs(v-result.angles[i])<.05)))continue;
      const endpoint=yield* edge(result.angles,result.angles,limits);
      if(endpoint){firstHit??=endpoint;continue;}
      if(descentTarget){const checked=yield* descentRoute(result.angles,descentTarget,downward,forward,limits,releaseRange);
        if(!checked.route){firstHit??="하강 경로 · "+checked.blockedBy;continue;}}
      if(pickTilted(result.angles)){skippedTilted=true;continue;}

      candidates.push(result);
      const hit=yield* edge(start,result.angles,limits);
      if(!hit){ikSolveStats.numeric++;return {...pack(result.angles),error:result.error,reachable:true};}
      firstHit??=hit;
      if(hit===WRIST_FULL_TURN){
        // The solver wandered more than half a turn on hand04; solve the same
        // seed again inside the half turn so the short rotation is used.
        const short=yield* solvePosition(forward,seed,withinHalfTurn(limits,start),worldTarget,downward,NUMERICAL_IK.positionTolerance,allowedTilt,releaseRange);
        const wristOK=!constraints?.wristAbovePoint || forward(short.angles).wristPosition.y>=worldTarget.y+MOTION.contactTolerance;
        if(short.converged&&wristOK&&!(yield* edge(short.angles,short.angles,limits))){
          const descentOK=!descentTarget||(yield* descentRoute(short.angles,descentTarget,downward,forward,limits,releaseRange)).route;
          if(descentOK&&!(yield* edge(start,short.angles,limits))){ikSolveStats.numeric++;return {...pack(short.angles),error:short.error,reachable:true};}
        }
      }
      // A continuous joint's shortest turn can cross the pallet/body. Check
      // the equivalent long turn explicitly instead of hoping RRT finds it.
      const oppositeTurns = heldBoxOnly ? [[3],[4],[3,4],[0],[2],[0,2],[0,3],[0,4],[2,3],[2,4]] : [[0],[2],[3],[4],[0,2],[0,3],[0,4],[2,3],[2,4],[3,4]];
      for (const indices of oppositeTurns) {
        const reverse=[...result.angles];
        for(const i of indices)if(!Number.isFinite(all[i].min)&&!all[i].locked&&!(i===0&&Math.abs(reverse[0]-start[0])<MIN_SHORT_BASE_TURN))
          reverse[i]-=Math.sign(reverse[i]-start[i]||1)*Math.PI*2;
        if(indices.every(i=>reverse[i]===result.angles[i]))continue;
        if(!(yield* edge(start,reverse,limits))){ikSolveStats.numeric++;return {...pack(reverse),error:result.error,reachable:true};}
      }
      if(candidates.length>=NUMERICAL_IK.endpointCandidates)break;
      yield;
      // Tracking stays near its current solution, but never skips the full retry on failure.
      if(tracking&&candidates.length>=3)break;
    }
    // Closed-form endpoints whose direct sweep was blocked are the first RRT goals.
    candidates.sort((a,b)=>a.angles.reduce((sum,v,i)=>sum+(v-start[i])**2,0)-b.angles.reduce((sum,v,i)=>sum+(v-start[i])**2,0));
    candidates.unshift(...analyticBlocked.slice(0,2));
    if(candidates.length){
      const straight=yield* cartesianRoute(start,worldTarget,downward,forward,limits);
      if(straight.route){
        const end=straight.route.at(-1)!, values=unpack(end), pose=forward(values);
        const wristOK=!constraints?.wristAbovePoint || pose.wristPosition.y>=worldTarget.y+MOTION.contactTolerance;
        const descent=descentTarget?yield* descentRoute(values,descentTarget,downward,forward,limits,releaseRange):null;
        if(wristOK&&(!descent||descent.route)){ikSolveStats.rrt++;return {...end,error:pose.position.distanceTo(worldTarget),reachable:true,route:straight.route,step:0};}
      }
      for(const candidate of candidates.slice(0,3)){
        const route=yield* jointRoute(start,candidate.angles,limits);
        if(route){ikSolveStats.rrt++;return {...pack(candidate.angles),error:candidate.error,reachable:true,route,step:0};}
      }
    }
    if(skippedTilted)return yield* planWith(kinematics,worldTarget,wristAbove,tracking,sliceSolver,fastPlacement,toolRotation,constrainPlacementWrist,descentTarget,{...constraints,relaxPickTilt:true});
    const reason=firstHit ? (candidates.length ? "경로 충돌 · " : "목표 자세 충돌 · ")+firstHit : position.converged&&downward
      ? "위치는 도달 가능 · 하향 자세와 관절 제한을 동시에 만족하는 해 미발견"
      : "위치 해 탐색 미수렴 · 오차 "+(best.error*1000).toFixed(1)+"mm (도달 불가 확정 아님)";
    ikSolveStats.failed++;
    return {...pack(start),error:best.error,reachable:false,blockedBy:reason};
  }
  const planningWork=new WeakMap<ReturnType<typeof startPlan>,number>();
  /** Smoothed cost (ms) of one generator step per search, used to stop before a step would overrun the budget. */
  const stepEstimate=new WeakMap<ReturnType<typeof startPlan>,number>();
  function advancePlan(search:ReturnType<typeof startPlan>,budgetMs=IK_CONFIG.planningBudgetMs,workLimitMs=Infinity){
    const began=performance.now();
    let estimate=stepEstimate.get(search);
    // At least one step per call (progress); afterwards only while the expected next step still fits.
    for(;;){
      const before=performance.now(),result=search.next(),now=performance.now();
      if(result.done){planningWork.delete(search);stepEstimate.delete(search);return result.value;}
      estimate=estimate===undefined?now-before:Math.max(now-before,estimate*0.7+(now-before)*0.3);
      if(now-began+estimate>=budgetMs)break;
    }
    stepEstimate.set(search,estimate*0.9);
    const work=(planningWork.get(search)??0)+performance.now()-began;planningWork.set(search,work);
    if(work>=workLimitMs){planningWork.delete(search);stepEstimate.delete(search);return {...pack(read()),error:Infinity,reachable:false,reason:"timeout" as const};}
    return null;
  }
  /** Deterministic advance: exactly `steps` generator steps (no wall-clock), result when the search finishes. */
  function advancePlanSteps(search:ReturnType<typeof startPlan>,steps:number){
    for(let i=0;i<steps;i++){const result=search.next();if(result.done){planningWork.delete(search);stepEstimate.delete(search);return result.value;}}
    return null;
  }
  function plan(target:Vector3,wristAbove=false,tracking=false){const search=startPlan(target,wristAbove,tracking);for(;;){const result=search.next();if(result.done)return result.value;}}
  const stepScratch:number[]=[];
  function stepAngles(saved: number[], next: number[]) {
    lastMotionBlock=null;
    realElevation=shoulderElevation();
    let samples=1;
    for(let i=0;i<next.length;i++)samples=Math.max(samples,Math.ceil(Math.abs(next[i]-saved[i])/IK_CONFIG.angularSample));
    const values=stepScratch;values.length=saved.length;
    for(let sample=1;sample<=samples;sample++){
      for(let i=0;i<saved.length;i++)values[i]=MathUtils.lerp(saved[i],next[i],sample/samples);applySample(values);
      const hit=violation(values);
      if(hit){lastMotionBlock=hit;blockedWristDirection=Math.sign(next[3]-saved[3]);blockedBaseDirection=Math.sign(next[0]-saved[0]);apply(saved);return false;}
    }
    // Samples only refreshed the grip chain; the accepted pose updates the whole robot once.
    model.updateWorldMatrix(true,true);collisions.syncHeld();
    return true;
  }
  /** Tool-level compensation: hand04 shifted (weight 0..1, at most maxStep rad) so the tool pitch tends to vertical. */
  function levelled(next:number[],weight:number,maxStep:number):number[]|null{
    if(!toolLevel||!ROBOT_PICKING.toolLevelCompensation||!analytic||weight<=0)return null;
    const pitch=analytic.pitchOf(next),error=Math.atan2(Math.sin(VERTICAL-pitch),Math.cos(VERTICAL-pitch));
    if(Math.abs(error)<1e-4)return null;
    const probe=next.slice();probe[3]+=0.05;
    const p2=analytic.pitchOf(probe),slope=Math.atan2(Math.sin(p2-pitch),Math.cos(p2-pitch))/0.05;
    if(Math.abs(slope)<0.5)return null;
    const out=next.slice();
    out[3]=MathUtils.clamp(next[3]+MathUtils.clamp(error/slope*weight,-maxStep,maxStep),all[3].min,all[3].max);
    return Math.abs(out[3]-next[3])>1e-6?out:null;
  }
  function stepLevelled(saved:number[],next:number[],weight:number,maxStep:number){
    const lv=levelled(next,weight,maxStep);
    if(lv){if(stepAngles(saved,lv)){ikSolveStats.levelCompensated++;return true;}ikSolveStats.levelFallback++;}
    return stepAngles(saved,next);
  }
  function animate(pose:IKPose,dt:number){
    if(!pose.reachable)return false;
    const target=unpack(pose.route?.[pose.step??0]??pose),saved=read();
    const duration=Math.max(...target.map((value,i)=>Math.abs(value-saved[i])/(i===0?MOTION.baseAngularSpeed:MOTION.angularSpeed)));
    const progress=duration>0?Math.min(1,dt/duration):1;
    const next=saved.map((value,i)=>MathUtils.lerp(value,target[i],progress));
    const remaining=Math.max(...target.map((value,i)=>Math.abs(value-next[i])));
    if(!stepLevelled(saved,next,Math.min(1,remaining/0.3),MOTION.angularSpeed*dt))return false;
    if(progress===1&&pose.route&&(pose.step??0)<pose.route.length-1)pose.step=(pose.step??0)+1;
    return true;
  }
  const animations = new WeakMap<IKPose,{from:number[];target:number[];elapsed:number;duration:number;blend:number;step:number}>();
  const easedScratch:number[]=[];
  /**
   * MoveJ along the current route segment with a synchronized, time-optimal trapezoid: all joints start and stop
   * together and none exceeds its speed (MOTION.*AngularSpeed) or acceleration (MOTION.*AngularAcceleration) limit.
   * speedScale scales speed linearly and acceleration quadratically (same shape, slower).
   */
  function animateEased(pose: IKPose, delta: number, speedScale = 1) {
    if(!pose.reachable)return false;
    const step=pose.step??0;
    let animation=animations.get(pose);
    if(!animation||animation.step!==step){
      const from=read(),target=unpack(pose.route?.[step]??pose),scale=Math.max(speedScale,0.01);
      for(let i=0;i<target.length;i++)easedScratch[i]=target[i]-from[i];
      easedScratch.length=target.length;
      const profile=synchronizedTrapezoid(easedScratch,
        i=>(i===0?MOTION.baseAngularSpeed:MOTION.angularSpeed)*scale,
        i=>(i===0?MOTION.baseAngularAcceleration:MOTION.angularAcceleration)*scale*scale);
      animation={from,target,elapsed:0,duration:Math.max(profile.duration,0.05),blend:profile.blend,step};animations.set(pose,animation);
    }
    const elapsed=Math.min(animation.duration,animation.elapsed+delta);
    const progress=trapezoid(elapsed/animation.duration,animation.blend);
    const {from,target}=animation;
    for(let i=0;i<target.length;i++)easedScratch[i]=MathUtils.lerp(from[i],target[i],progress);
    easedScratch.length=target.length;
    const p=elapsed/animation.duration;
    if(!stepLevelled(read(),easedScratch,Math.min(1,Math.min(p,1-p)/0.15),Math.PI))return false;
    animation.elapsed=elapsed;
    if(elapsed===animation.duration&&pose.route&&step<pose.route.length-1)pose.step=step+1;
    return true;
  }
  function isEasedSettled(pose: IKPose) {
    const animation=animations.get(pose);
    return Boolean(animation&&animation.elapsed===animation.duration&&animation.step===(pose.step??0)&&isSettled(pose));
  }
  function isSettled(pose:IKPose){return (!pose.route||(pose.step??0)===pose.route.length-1)&&controls.every((c,i)=>Math.abs(c.angle-pose.angles[i])<IK_CONFIG.settledAngle)&&Math.abs(baseControl.angle-pose.baseYaw)<IK_CONFIG.settledBaseAngle;}
  /** Rebuild from the last safe angles, never from the rejected or originally planned pose. */
  function* startCollisionRecovery(blocked: IKPose, fixedBase?: number, baseOnly = false, replan?: () => Generator<void, IKPose, void>, worldTarget?: Vector3): Generator<void, IKPose, void> {
    const start=read(),goal=unpack(blocked),limits=limitsAround(start,{baseYaw:fixedBase});
    if(baseOnly)for(let i=1;i<limits.length;i++)limits[i]=[start[i],start[i]];
    const axis=baseOnly?0:3;
    const direction=-Math.sign((baseOnly?blockedBaseDirection:blockedWristDirection)||goal[axis]-start[axis]||1);
    // Solver-chain construction below is its own slice; the caller only created the generator.
    yield;
    const point=worldTarget?.clone()??(blocked.reachable?forwardOnly(goal).position:null);
    // Flip the physical wrist posture by ~180 degrees and solve shoulder/elbow again.
    // +/-360 alone only changes travel direction and leaves the same colliding end posture.
    if(!baseOnly&&point)for(const sign of [direction,-direction]){
      const center=goal[3]+sign*Math.PI,spread=MathUtils.degToRad(IK_CONFIG.oppositeWristSpreadDegrees);
      const opposite=yield* startConstrainedPlan(point,{baseYaw:fixedBase,wristRange:[center-spread,center+spread]});
      if(opposite.reachable)return {...opposite,target:blocked.target};
    }
    const destinations=[...new Set([direction,-direction])].map(sign=>{
      const values=[...goal];
      const turn=values[axis]-start[axis];
      if(Math.sign(turn)!==sign){
        if(axis===0&&Math.abs(turn)<MIN_SHORT_BASE_TURN)return null;
        values[axis]+=sign*Math.PI*2;
      }
      return values;
    }).filter((values):values is number[]=>values!==null);
    // Try the reverse sweep first, then the other direction from these same current angles.
    for(const values of blocked.reachable?destinations:[]){
      if(!(yield* edge(start,values,limits)))return {...pack(values),error:blocked.error,reachable:true,target:blocked.target};
    }
    // Both full sweeps are blocked. Alternate small escape turns and recompute a detour.
    if(!baseOnly)for(const degrees of IK_CONFIG.collisionEscapeDegrees){
      for(const sign of [direction,-direction]){
        const escape=[...start];escape[3]+=MathUtils.degToRad(degrees)*sign;
        if(yield* edge(start,escape,limits))continue;
        for(const values of blocked.reachable?destinations:[]){
          const direct=yield* edge(escape,values,limits);
          const tail=direct?yield* jointRoute(escape,values,limits,IK_CONFIG.collisionRecoveryIterations):[pack(values)];
          if(tail)return {...pack(values),error:blocked.error,reachable:true,target:blocked.target,route:[pack(escape),...tail],step:0};
        }
        if(replan){
          const replanned=yield* fromPose(escape,replan);
          if(replanned.reachable)return {...replanned,route:[pack(escape),...(replanned.route??[pack(unpack(replanned))])],step:0};
        }
      }
    }
    return {...pack(start),error:blocked.error,reachable:false,blockedBy:"박스 / hand03 양방향 회피 경로 미발견"};
  }
  function isCartesianSettled(pose: IKPose) {
    const target=unpack(pose);
    return (!pose.route||(pose.step??0)===pose.route.length-1)
      && all.every((control,i)=>Math.abs(control.angle-target[i])<IK_CONFIG.cartesianSettledAngle);
  }
  function startConstrainedPlan(target: Vector3, constraints: IKConstraints, downward = Boolean(constraints.wristAbovePoint)) {
    return startPlan(target,downward,false,true,false,undefined,false,constraints.descentTarget,constraints);
  }
  function startCartesianPlan(target: Vector3, constraints: IKConstraints) {
    return startPlan(target,Boolean(constraints.wristAbovePoint),false,true,false,carryRotation,false,undefined,constraints);
  }
  function* startBaseAlignment(target: Vector3): Generator<void, IKPose, void> {
    const start = read(), pivot = baseNode.getWorldPosition(new Vector3());
    const source = grip.getWorldPosition(new Vector3()).sub(pivot), destination = target.clone().sub(pivot);
    const normal = controls[0].axis.clone().transformDirection(controls[0].node.matrixWorld).normalize();
    const axis=baseControl.axis.clone().transformDirection(baseNode.matrixWorld).normalize();
    const parallel=axis.clone().multiplyScalar(axis.dot(normal));
    const a=destination.dot(normal.clone().sub(parallel)),b=destination.dot(axis.clone().cross(normal));
    const lateral=source.dot(normal)-destination.dot(parallel),radius=Math.hypot(a,b);
    const destinationHeading = Math.atan2(-destination.z,destination.x);
    const nearTurn = destinationHeading-Math.atan2(-source.z,source.x);
    const offset = Math.acos(MathUtils.clamp(lateral/Math.max(radius,1e-9),-1,1));
    const phase=Math.atan2(b,a);
    const turns = [phase+offset,phase-offset];
    turns.sort((a,b) => Math.abs(nearest(a,nearTurn)-nearTurn)-Math.abs(nearest(b,nearTurn)-nearTurn));
    yield;
    const forward = forwardOnly;
    // Closed-form heading: the hand00 angle of the cheapest full arm solution (facing or backward reach),
    // so the following fixed-base transit lands on that same solution. Falls back to the geometric turns.
    const headings = (yield* analyticSearch(start,target,limitsAround(start),Math.min(analyticTiltLimit(Boolean(payloadCollision?.holding)),IK_CONFIG.toolTiltFallbackCapDegrees),forward))
      .map(c=>c.angles[0]);
    let values = [...start], hit: string | null = "hand00 정렬 해 없음";
    for (const yaw of [...headings.slice(0,4), ...turns.map(turn=>nearest(start[0]+turn,start[0]))]) {
      values = [...start]; values[0] = yaw;
      hit = yield* edge(start,values);
      if (!hit) break;
    }
    const point = forward(values).position;
    return {...pack(values),error:0,reachable:!hit,blockedBy:hit??undefined,target:point};
  }
  // Nested planning runs from a proposed checkpoint, restoring the real pose at every yield.
  function* fromPose(values: number[], search: () => Generator<void, IKPose, void>): Generator<void, IKPose, void> {
    let virtual=[...values];
    const plan=search();
    try {
      for(;;){
        const actual=read();
        let next: IteratorResult<void,IKPose>;
        try {apply(virtual);next=plan.next();virtual=read();} finally {apply(actual);}
        if(next.done)return next.value;
        yield;
      }
    } finally {
      const actual=read();
      try {plan.return({...pack(virtual),error:0,reachable:false});} finally {apply(actual);}
    }
  }
  /** Prefer the upright base turn, then synchronize every moving joint in one MoveJ. */
  function* startBaseTransfer(target: Vector3, placement: Vector3): Generator<void, IKPose, void> {
    target=target.clone();placement=placement.clone();
    const start=read();
    const alignment=yield* startBaseAlignment(target);
    if(!alignment.reachable)return yield* startConstrainedPlan(target,{descentTarget:placement});
    const transit=yield* fromPose(unpack(alignment),()=>startConstrainedPlan(target,{baseYaw:alignment.baseYaw,descentTarget:placement}));
    if(!transit.reachable)return transit;
    const goal=unpack(transit);
    if(!(yield* edge(start,goal)))return {...transit,route:undefined,step:undefined,target};
    const detour=yield* jointRoute(start,goal,limitsAround(start));
    if(detour)return {...transit,route:detour,step:0,target};
    // A verified waypoint is retained only when the simultaneous sweep is obstructed.
    return {...transit,route:[pack(unpack(alignment)),...(transit.route??[pack(goal)])],step:0,target};
  }
  function* startShoulderTransfer(destination: Vector3, placement: Vector3, prepared?: IKPose): Generator<void, IKPose, void> {
    destination=destination.clone();placement=placement.clone();
    const start=read(),forward=forwardOnly;
    yield;
    if(prepared?.reachable&&!(yield* edge(start,unpack(prepared))))return prepared;
    const pivot=baseNode.getWorldPosition(new Vector3()),front=forward(start).position.clone().sub(pivot).setY(0).normalize();
    // Keep the search finite even when the shoulder has no mechanical stops.
    const shoulderMax=Math.min(controls[0].max,start[1]+Math.PI);
    let firstHit: string | null=null,checked=0;
    function* continuation(values:number[]): Generator<void, IKPose|null, void> {
      const hit=yield* edge(start,values);if(hit){firstHit??=hit;return null;}
      const alignment=yield* fromPose(values,()=>startBaseAlignment(destination));
      if(!alignment.reachable){firstHit??=alignment.blockedBy??null;return null;}
      const transit=yield* fromPose(unpack(alignment),()=>startConstrainedPlan(destination,{baseYaw:alignment.baseYaw,descentTarget:placement}));
      if(!transit.reachable){firstHit??=transit.blockedBy??null;return null;}
      return {...pack(values),error:0,reachable:true,target:forward(values).position,alignment,transit};
    }
    // Prefer a complete rear swing, but accept it only when the following alignment and transit are safe too.
    for(let shoulder=shoulderMax;shoulder>start[1]+MathUtils.degToRad(1)&&checked<8;shoulder-=MathUtils.degToRad(4)){
      for(let n=0;n<=36&&checked<8;n++){
        const values=[...start],delta=n===0?0:MathUtils.degToRad(Math.ceil(n/2)*10)*(n%2?1:-1);
        values[1]=shoulder;values[2]+=delta;values[3]-=shoulder-start[1]+delta;
        const point=forward(values).position;
        if(point.clone().sub(pivot).dot(front)>=0||minimumToolHeight!==null&&point.y<minimumToolHeight)continue;
        if(yield* edge(start,values))continue;
        checked++;const result=yield* continuation(values);if(result)return result;
      }
      yield;
    }
    // Keep the largest safe shoulder swing when a full rear swing prevents reaching the slot.
    for(let shoulder=shoulderMax;shoulder>start[1]+MathUtils.degToRad(1);shoulder-=MathUtils.degToRad(4)){
      const values=[...start];values[1]=shoulder;values[3]-=shoulder-start[1];
      if(yield* edge(start,values))continue;
      const result=yield* continuation(values);if(result)return result;
    }
    const result=yield* continuation(start);if(result)return result;
    return {...pack(start),error:0,reachable:false,blockedBy:firstHit??"이송까지 연결되는 안전한 경유 자세가 없습니다."};
  }
  /** Prepare the rear transfer from the lift endpoint while the real arm keeps lifting. */
  function prepareShoulderTransfer(liftTarget: Vector3, destination: Vector3, placement: Vector3) {
    return fromPose(read(),()=>prepareShoulderTransferAtPose(liftTarget,destination,placement));
  }
  function* prepareShoulderTransferAtPose(liftTarget: Vector3, destination: Vector3, placement: Vector3): Generator<void,IKPose,void> {
    liftTarget=liftTarget.clone();destination=destination.clone();placement=placement.clone();
    const lift=yield* startConstrainedPlan(liftTarget,{baseYaw:baseControl.angle});
    if(!lift.reachable)return lift;
    const search=fromPose(unpack(lift),()=>startShoulderTransfer(destination,placement));
    for(;;){
      const height=minimumToolHeight;
      let next: IteratorResult<void,IKPose>;
      try {
        minimumToolHeight=destination.y;
        next=search.next();
      } finally {minimumToolHeight=height;}
      if(next.done)return next.value;
      yield;
    }
  }
  function* startPickupPlan(target: Vector3): Generator<void, IKPose, void> {
    const start=controls[2].angle;
    const usual=yield* startConstrainedPlan(target,{wristAbovePoint:true});
    if(!usual.reachable)return usual;
    const direction=Math.sign(usual.angles[2]-start);
    if(!direction)return usual;
    const wristRange: [number,number]=direction>0?[controls[2].min,start]:[start,controls[2].max];
    const reversed=yield* startConstrainedPlan(target,{wristAbovePoint:true,wristRange});
    // The reversed-wrist solve may only fall back to a numeric, tilted cup (up to ~55 deg after a big hand00 turn):
    // keep it only when the suction face is as close to straight down as the usual solve.
    if(!reversed.reachable||!analytic)return usual;
    const tiltOf=(pose:IKPose)=>tiltFromVertical(analytic!.pitchOf(unpack(pose)));
    return tiltOf(reversed)<=tiltOf(usual)+MathUtils.degToRad(5)?reversed:usual;
  }
  /** Branch, tool pitch and hand00 of the current pose; held fixed along one straight vertical segment. */
  /** `vertical`: tool pitch is driven to (and held at) world vertical along the whole segment (PLACE). */
  function lineLock(vertical = false): LineLock | null {
    if (!analytic) return null;
    const values = read();
    const pitch = analytic.pitchOf(values);
    // The easing knee starts at or beyond the current reach, so the first waypoint never re-tilts the tool.
    const ratio = analytic.reachRatioOf(values);
    const softReach = Math.max(LINE_SOFT_REACH, ratio + 1e-6), maxReach = Math.max(LINE_MAX_REACH, softReach + 0.02);
    return { baseYaw: values[0], pitch, origin: pitch, softReach, maxReach: Math.min(maxReach, 0.995), ...analytic.branchOf(values), vertical };
  }
  /**
   * Closed-form point on a straight segment: same hand00, branch and tool pitch as `lock`, so successive
   * points form one continuous joint curve (no solver switching, no re-planning). Null when out of reach,
   * outside joint limits, or when the next point would jump (caller then falls back to the planner).
   */
  function solveLine(target: Vector3, lock: LineLock): IKPose | null {
    if (!analytic) return null;
    const start = read();
    // Only the locked branch: crossing the straight-elbow boundary mid-lift is what made hand02 jerk.
    // Near full reach the tool turns continuously (wrist held on the reach limit) instead of in steps, and only
    // the locked branch is accepted: crossing the straight-elbow boundary mid-lift is what made hand02 jerk.
    let best: number[] | null = null, bestPitch = lock.pitch, bestJump = Infinity;
    const vertical = Boolean(lock.vertical);
    lock.origin = vertical ? stepToVertical(lock.pitch) : towardVertical(lock.pitch);
    // vertical: exact pitch (no reach-easing tilt); out of reach -> null -> planner fallback
    for (const solution of analytic.solve(target, start, { pitch: lock.origin, keepElbow: false, maxReachRatio: lock.maxReach, adjustPitch: !vertical, softReachStart: lock.softReach })) {
      if (solution.front !== lock.front || solution.elbow !== lock.elbow) continue;
      if (!vertical && tiltFromVertical(solution.pitch) > Math.max(TILT_CAP, tiltFromVertical(lock.pitch) + 1e-6)) continue;
      const angles = solution.angles;
      if (Math.abs(angles[0] - lock.baseYaw) > 2e-3) continue;
      angles[0] = lock.baseYaw;
      if (all[4].locked) angles[4] = start[4];
      const jump = Math.max(...angles.map((value, i) => Math.abs(value - start[i])));
      if (jump > ANALYTIC_STEP_CONTINUITY || jump >= bestJump) continue;
      if (clipsBelt(angles) && !clipsBelt(start)) continue;
      best = angles; bestPitch = solution.pitch; bestJump = jump;
    }
    if (best) { lock.pitch = bestPitch; return { ...pack(best), error: 0, reachable: true, target: target.clone() }; }
    return null;
  }
  /**
   * Moving-pickup tracking: closed-form solve of `target` on the locked branch and tool pitch like solveLine,
   * but hand00 may follow the box. Cheap enough for every sub-step; null when it would jump or leave reach.
   */
  /**
   * Direct closed-form approach to a (moving) hover point: vertical tool (then +/-10 deg), wrist above the point,
   * cheapest time-weighted travel with posture and branch-change costs. No planner, a few solves; null if none.
   */
  function solveApproach(target: Vector3): IKPose | null {
    if (!analytic) return null;
    const start = read(), limits = limitsAround(start), branch = analytic.branchOf(start);
    let best: number[] | null = null, bestCost = Infinity;
    const sweep = IK_CONFIG.approachTiltDegrees;
    for (const tilt of [0, sweep, -sweep]) {
      for (const solution of analytic.solve(target, start, { pitch: -Math.PI / 2 + MathUtils.degToRad(tilt), keepElbow: false, maxReachRatio: LINE_MAX_REACH })) {
        const angles = solution.angles;
        if (all[4].locked) angles[4] = start[4];
        if (angles.some((value, i) => value < limits[i][0] - 1e-8 || value > limits[i][1] + 1e-8)) continue;
        if (forwardOnly(angles).wristPosition.y < target.y + MOTION.contactTolerance) continue;
        const cost = travelCost(start, angles) + postureCost(angles) + ANALYTIC_TILT_COST * Math.abs(tilt)
          + (solution.front !== branch.front ? ANALYTIC_BRANCH_COST : 0) + (solution.elbow !== branch.elbow ? ANALYTIC_BRANCH_COST / 2 : 0)
          + (clipsBelt(angles) ? IK_CONFIG.beltClipCost : 0);
        if (cost < bestCost) { best = angles; bestCost = cost; }
      }
      if (best) { if (tilt) ikSolveStats.verticalFallback++; break; }
    }
    return best ? { ...pack(best), error: 0, reachable: true, target: target.clone() } : null;
  }
  /**
   * After LIFT: hand01 back to `shoulder` (its home angle) with hand00 fixed, so the carry starts from the
   * tucked shoulder instead of an arm stretched over neighbouring equipment. hand02 is swept for a pose whose
   * tool stays at or above `minY` (box never dips), hand04 keeps the current tool pitch; nearest collision-free
   * pose wins. Unreachable when no such pose exists (the caller then carries on from the lifted pose).
   */
  function* startShoulderRestore(shoulder: number, minY: number, raise = 0, inwardTolerance = Infinity, pathSamples = 0, elbowRaise = 0): Generator<void, IKPose, void> {
    yield;
    const start = read(), limits = limitsAround(start);
    // Held box vs robot body: the tool (box) must not come closer to the hand00 axis than at the lift point,
    // along the whole synchronized joint path (animateEased lerps all joints together) -> hand02 lifts instead of folding in.
    const pivot = baseNode.getWorldPosition(new Vector3());
    const radial = (p: Vector3) => Math.hypot(p.x - pivot.x, p.z - pivot.z);
    const minRadial = radial(forwardOnly(start).position) - inwardTolerance;
    const lerped = start.slice();
    // relaxed: the hand02 raise may swing the box toward the body; only the body collision check (edge) limits it.
    const pathClear = (angles: number[], relaxed = false) => {
      for (let k = 1; k <= pathSamples; k++) {
        const t = k / pathSamples;
        for (let i = 0; i < angles.length; i++) lerped[i] = start[i] + (angles[i] - start[i]) * t;
        const p = forwardOnly(lerped).position;
        if (p.y < minY || (!relaxed && radial(p) < minRadial)) return false;
      }
      return true;
    };
    // "Up" for hand01 is whichever sign lifts the elbow (axis signs differ per model).
    if (raise) {
      const probe = (q: number) => { const a = start.slice(); a[1] = q; forwardOnly(a, jointPoints); return jointPoints[2].y; };
      shoulder = probe(shoulder + raise) >= probe(shoulder - raise) ? shoulder + raise : shoulder - raise;
    }
    const fail: IKPose = { ...pack(start), error: Infinity, reachable: false, blockedBy: "hand01 복귀 자세 없음" };
    if (!analytic) return fail;
    const current = analytic.pitchOf(start), target = nearest(shoulder, start[1]);
    // Rigid lift (the arm's ㄱ tips up into >): hand01 rotates up and hand02 rises with it in one synchronized
    // move, both in the lifting direction; hand04 only keeps the cup pointing down. Box goes up (and a bit inward),
    // limited by joint limits, the belt and the body collision check, not by an inward tolerance.
    const rigid = MathUtils.degToRad(ROBOT_PICKING.liftRigidShoulderDegrees);
    if (elbowRaise && rigid) {
      const elbowY = (q: number) => { const a = start.slice(); a[1] = q; forwardOnly(a, jointPoints); return jointPoints[2].y; };
      const s1 = elbowY(start[1] + 0.05) >= elbowY(start[1] - 0.05) ? 1 : -1;
      const y0 = forwardOnly(start).position.y;
      for (const scale of [1, 0.75, 0.5, 0.25]) {
        const a = start.slice(); a[1] += s1 * rigid * scale;
        const wristY = (d: number) => { const b = a.slice(); b[2] += d; return forwardOnly(b).wristPosition.y; };
        a[2] += (wristY(0.05) >= wristY(-0.05) ? 1 : -1) * elbowRaise * scale;
        const p0 = analytic.pitchOf(a); a[3] += 0.1; const k = Math.atan2(Math.sin(analytic.pitchOf(a) - p0), Math.cos(analytic.pitchOf(a) - p0)) / 0.1; a[3] -= 0.1;
        if (Math.abs(k) < 0.5) continue;
        a[3] += Math.atan2(Math.sin(VERTICAL - p0), Math.cos(VERTICAL - p0)) / k;
        if (a.some((value, i) => value < limits[i][0] - 1e-8 || value > limits[i][1] + 1e-8)) continue;
        const pose = forwardOnly(a);
        if (pose.position.y < Math.max(minY, y0 + 0.02) || pose.wristPosition.y < pose.position.y || clipsBelt(a) || !pathClear(a, true)) continue;
        if (!(yield* edge(start, a, limits))) { ikSolveStats.elbowRaised++; return { ...pack(a), error: 0, reachable: true }; }
      }
      // No rigid lift fits: carry on from the lifted pose rather than a restore that could lower hand01.
      return fail;
    }
    const candidates: { angles: number[]; cost: number; up: boolean }[] = [];
    // hand02 +elbowRaise rides along with the hand01 move (one synchronized joint move): the sign that raises the tool.
    let elbowRef = start[2];
    if (elbowRaise) {
      // Sign judged on the hand04-levelled (suction down) pose, as the move will actually end.
      const lift = (d: number) => {
        const a = start.slice(); a[1] = target; a[2] += d;
        const p0 = analytic!.pitchOf(a); a[3] += 0.1; const k = Math.atan2(Math.sin(analytic!.pitchOf(a) - p0), Math.cos(analytic!.pitchOf(a) - p0)) / 0.1; a[3] -= 0.1;
        if (Math.abs(k) >= 0.5) a[3] += Math.atan2(Math.sin(VERTICAL - p0), Math.cos(VERTICAL - p0)) / k;
        return forwardOnly(a).position.y;
      };
      elbowRef = start[2] + (lift(elbowRaise) >= lift(-elbowRaise) ? elbowRaise : -elbowRaise);
    }
    const preferred = start.slice(); preferred[2] = elbowRef;
    // Suction face down first (tool = world -Y); the current pitch only as fallback.
    for (const pitch of [VERTICAL, current]) for (let step = -36; step <= 36; step++) {
      const angles = start.slice();
      angles[1] = target; angles[2] = start[2] + step * Math.PI / 36;
      // Tool pitch is linear in hand04 (parallel axes): one finite difference gives its sign.
      const base = analytic.pitchOf(angles);
      angles[3] += 0.1;
      const slope = Math.atan2(Math.sin(analytic.pitchOf(angles) - base), Math.cos(analytic.pitchOf(angles) - base)) / 0.1;
      angles[3] -= 0.1;
      if (Math.abs(slope) < 0.5) continue;
      angles[3] += Math.atan2(Math.sin(pitch - base), Math.cos(pitch - base)) / slope;
      const isUp = !!elbowRaise && Math.abs(angles[2] - elbowRef) < Math.abs(elbowRaise) / 2;
      if (angles.some((value, i) => value < limits[i][0] - 1e-8 || value > limits[i][1] + 1e-8)) continue;
      const pose = forwardOnly(angles);
      if (pose.position.y < minY || pose.wristPosition.y < pose.position.y || (!isUp && radial(pose.position) < minRadial) || clipsBelt(angles)) continue;
      if (!pathClear(angles, isUp)) continue;
      candidates.push({ angles, up: isUp, cost: travelCost(elbowRaise ? preferred : start, angles) + ANALYTIC_TILT_COST * MathUtils.radToDeg(tiltFromVertical(pitch)) });
    }
    candidates.sort((a, b) => a.cost - b.cost);
    // hand02 +elbowRaise on top of the chosen hand01 restore pose (same synchronized move), hand04 re-levelled.
    const level = (b: number[], want: number) => {
      const p0 = analytic!.pitchOf(b); b[3] += 0.1; const k = Math.atan2(Math.sin(analytic!.pitchOf(b) - p0), Math.cos(analytic!.pitchOf(b) - p0)) / 0.1; b[3] -= 0.1;
      if (Math.abs(k) < 0.5) return false; b[3] += Math.atan2(Math.sin(want - p0), Math.cos(want - p0)) / k; return true;
    };
    const raisedOf = (a: number[]) => {
      if (!elbowRaise) return null;
      const want = analytic!.pitchOf(a), y0 = forwardOnly(a).position.y;
      let best: number[] | null = null, bestY = y0 + 0.02;
      for (const d of [elbowRaise, -elbowRaise]) {
        const b = a.slice(); b[2] += d;
        if (!level(b, want)) continue;
        if (b.some((value, i) => value < limits[i][0] - 1e-8 || value > limits[i][1] + 1e-8)) continue;
        const pose = forwardOnly(b);
        if (pose.wristPosition.y < pose.position.y) continue;
        if (clipsBelt(b)) continue;
        if (!pathClear(b, true)) continue;
        if (pose.position.y > bestY) { best = b; bestY = pose.position.y; }
      }
      return best;
    };
    for (const candidate of candidates.slice(0, 8)) {
      const up = raisedOf(candidate.angles);
      if (up) {
        const hitUp = yield* edge(start, up, limits);
        if (!hitUp) { ikSolveStats.elbowRaised++; return { ...pack(up), error: 0, reachable: true }; }
      }
      const hit = yield* edge(start, candidate.angles, limits);
      if (!hit) { if (candidate.up) ikSolveStats.elbowRaised++; return { ...pack(candidate.angles), error: 0, reachable: true }; }
      fail.blockedBy = hit;
    }
    // No hand01 restore pose: still lift together, hand01 part way (or held) plus hand02 +elbowRaise.
    for (const t of [0.5, 0.25, 0]) {
      const a = start.slice(); a[1] = start[1] + (target - start[1]) * t;
      if (!level(a, current)) continue;
      const up = raisedOf(a);
      if (up && !(yield* edge(start, up, limits))) { ikSolveStats.elbowRaised++; return { ...pack(up), error: 0, reachable: true }; }
    }
    return fail;
  }
  /** Why the last solveTrack returned null (diagnostics). */
  let lastTrackMiss: string | null = null;
  function solveTrack(target: Vector3, lock: LineLock): IKPose | null {
    lastTrackMiss = null;
    if (!analytic) { lastTrackMiss = "analytic IK unavailable"; return null; }
    const start = read();
    let best: number[] | null = null, bestJump = Infinity, solutions = 0, onBranch = 0, smallestJump = Infinity;
    let bestPitch = lock.pitch;
    // Near full reach the tool tilts continuously (like solveLine) instead of losing the solution.
    lock.origin = towardVertical(lock.pitch);
    for (const solution of analytic.solve(target, start, { pitch: lock.origin, keepElbow: false, maxReachRatio: lock.maxReach, adjustPitch: true, softReachStart: lock.softReach })) {
      solutions++;
      if (tiltFromVertical(solution.pitch) > Math.max(TILT_CAP, tiltFromVertical(lock.pitch) + 1e-6)) continue;
      if (solution.front !== lock.front || solution.elbow !== lock.elbow) continue;
      onBranch++;
      const angles = solution.angles;
      if (all[4].locked) angles[4] = start[4];
      let jump = 0;
      for (let i = 0; i < angles.length; i++) jump = Math.max(jump, Math.abs(angles[i] - start[i]));
      smallestJump = Math.min(smallestJump, jump);
      if (jump > TRACK_STEP_CONTINUITY || jump >= bestJump) continue;
      if (clipsBelt(angles) && !clipsBelt(start)) continue;
      best = angles; bestJump = jump; bestPitch = solution.pitch;
    }
    if (!best) {
      lastTrackMiss = !solutions ? "no closed-form solution (reach/limits)" : !onBranch ? `branch changed (${solutions} solutions, none front=${lock.front} elbow=${lock.elbow})` : `jump ${smallestJump.toFixed(2)} rad`;
      return null;
    }
    lock.baseYaw = best[0]; lock.pitch = bestPitch;
    return { ...pack(best), error: 0, reachable: true, target: target.clone() };
  }
  // Minimal FK adapter retained for callers that inspect the original chain.
  const effector={updateMatrixWorld:()=>model.updateWorldMatrix(true,true),getWorldPosition:(out:number[])=>grip.getWorldPosition(new Vector3()).toArray(out)};
  return {lineLock,solveTrack,solveApproach,solveLine:(t:Vector3,l:LineLock)=>{const r=solveLine(t,l);if(r)ikSolveStats.line++;else ikSolveStats.lineNoSolution++;return r;},plan,startPlan,startConstrainedPlan,startCartesianPlan,startBaseAlignment,startBaseTransfer,startShoulderRestore,startShoulderTransfer,prepareShoulderTransfer,startPickupPlan,advancePlan,advancePlanSteps,animate,animateEased,isSettled,isEasedSettled,isCartesianSettled,startCollisionRecovery,
    get lastMotionBlock(){return lastMotionBlock;},get lastTrackMiss(){return lastTrackMiss;},
    setMinimumToolHeight:(height:number|null)=>{minimumToolHeight=height;},setContactMode:(on:boolean)=>{contactMode=on;},setToolLevel:(on:boolean)=>{toolLevel=on;},setKeepOut:(boxes:readonly KeepOutBox[])=>{keepOut=boxes;},collisions,carryRotation,grip,controls,baseControl,effector};
}
