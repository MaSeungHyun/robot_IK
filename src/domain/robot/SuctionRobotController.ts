import { minimumJerk } from "@/domain/robot/ik/motionTiming";
import { profileEnd, profileStart } from "@/lib/profiler/frameProfiler";
import { Euler, Group, Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import { MOTION, IK_CONFIG, ROBOT_PICKING } from "@/constants/simulation";
import type { RobotController, RobotControllerOptions } from "@/domain/robot/RobotController";
import type { JointAngleReading, RobotPhase, RobotTransferMode, Transfer } from "@/types/robot";
import { createRobotIK, ikSolveStats, type IKPose, type LineLock } from "@/domain/robot/ik/robotIK";
import type { PlanningBudget } from "@/domain/robot/ik/planningScheduler";
import { setJointAngle } from "@/domain/robot/ik/joints";
import { isPickupInRange, isWristAboveBox, setCargoWorldPose } from "@/domain/robot/ik/picking";

const createRuntime = () => ({
  index: 0, phase: "HOME" as RobotPhase, elapsed: 0, duration: 0,
  target: new Vector3(), command: new Vector3(), segmentStart: new Vector3(), segmentEnd: new Vector3(),
  point: new Vector3(), gripOffset: new Vector3(),
  parent: null as Object3D | null, transportBaseYaw: 0,
  pickupWristStart: 0, pickupWristRange: null as [number,number] | null,
  pose: null as IKPose | null, recovery: null as IKPose | null, alignment: null as IKPose | null, transit: null as IKPose | null,
  planning: null as ReturnType<ReturnType<typeof createRobotIK>["startPlan"]> | null,
  transferPlanning: null as ReturnType<ReturnType<typeof createRobotIK>["prepareShoulderTransfer"]> | null,
  preparedShoulder: null as IKPose | null,
  /** Rejected plans in this phase and sim time waited since the last one (retry/abort policy). */
  failures: 0, retryWait: 0,
  /** Straight-segment lock (LIFT/PLACE/RETREAT): analytic branch+pitch; false = this segment uses the planner. */
  lineLock: null as LineLock | null | false,
  /** PRE_GRASP on a moving box: sim seconds spent waiting for the planner, and the closed-form approach in use. */
  planWait: 0, approachAnalytic: false, approach: null as IKPose | null, approachAge: 0,
  releasePosition: new Vector3(), releaseRotation: new Quaternion(), destinationRotation: new Quaternion(), rotation: new Quaternion(),
});
const PHASE_LABELS: Record<RobotPhase,string> = {
  HOME:"다음 박스 대기", PRE_GRASP:"박스 위 경유점으로 접근", GRASP:"박스 위에서 수직 하강",
  ATTACH:"집기 접촉 확인", LIFT:"hand00 고정 · 수직 상승",
  SHOULDER_TRANSFER:"hand01으로 뒤로 넘기기 · hand00 고정", ALIGN_BASE:"hand00으로 팔레트 좌우 정렬",
  TRANSIT:"슬롯 위 경유점으로 이동", PRE_PLACE:"슬롯 위에서 박스 방향 정렬", PLACE:"정렬 자세 유지 · 수직 하강",
  RELEASE:"박스 놓기", RETREAT:"놓은 뒤 수직 후퇴",
};
/** Equivalent of the initial yaw nearest the current angle; on a near tie, unwind toward it. */
function homeHeading(current:number,initial:number){
  const turn=2*Math.PI,nearestYaw=initial+turn*Math.round((current-initial)/turn);
  const unwound=initial+turn*Math.trunc((current-initial)/turn);
  return Math.abs(unwound-current)<=Math.PI+Math.PI/6?unwound:nearestYaw;
}
/** Retry a rejected (non-tracking) plan after waitSeconds of sim time; relax/abandon after N rejections. */
const RETRY = { waitSeconds: 0.5, relaxAfter: 3, abortAfter: 8 } as const;
/** hand05 tool roll: three.js local +Y (Blender local Z), the tool shaft; GripPoint sits ~3 mm off it. */
const TOOL_AXIS = new Vector3(0, 1, 0);
const toolTurn = new Quaternion(), toolInverse = new Quaternion(), toolOffset = new Vector3(), toolAxisWorld = new Vector3();
const wrapAngle = (angle: number) => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
const BEFORE_PICK: readonly RobotPhase[] = ["PRE_GRASP","GRASP","ATTACH"];
/** Hover height over the destination: prePlaceHeight above the slot, never below the pallet stack clearance. */
const hoverY=(job:Transfer)=>Math.max(job.destination.y+ROBOT_PICKING.prePlaceHeight,job.clearanceY??-Infinity);
const LINEAR_PHASES: readonly RobotPhase[] = ["GRASP","LIFT","PLACE","RETREAT"];
type CargoPose = { parent: Object3D | null; position: Vector3; quaternion: Quaternion; scale: Vector3 };

/** MoveJ between waypoints and MoveL for contact, with bounded wrist travel. */
export class SuctionRobotController implements RobotController {
  readonly id: string;
  readonly model: Group;
  readonly transferMode: RobotTransferMode;
  private active = false;
  private disposed = false;
  private readonly ik: ReturnType<typeof createRobotIK>;
  private readonly initialAngles: number[];
  private homePose: IKPose | null = null;
  private runtime = createRuntime();
  private manualAngle: { name: string; degrees: number } | null = null;
  private readonly cargo = new Map<Group, CargoPose>();
  private readonly origin = new Vector3();
  private readonly pickupRadius: number;

  private readonly options: RobotControllerOptions;
  /** hand05 (tool roll) node and its export pose; null when the model has no hand05 above GripPoint. */
  private readonly toolNode: Object3D | null;
  private readonly toolRest = new Quaternion();
  private readonly toolRestPosition = new Vector3();
  private readonly toolGripLocal = new Vector3();
  private toolRoll = 0;
  private toolRollFrom = 0;
  private toolRollGoal = 0;

  constructor(options: RobotControllerOptions) {
    this.options = options;
    this.id = options.id;
    this.model = options.model;
    this.transferMode = options.transferMode ?? ROBOT_PICKING.transferMode;
    this.pickupRadius = options.pickupRadius ?? ROBOT_PICKING.radius * (options.geometryScale ?? 1);
    if (!Number.isFinite(this.pickupRadius) || this.pickupRadius <= 0) throw new Error("Pickup radius must be positive");
    this.ik = createRobotIK(this.model, options.geometryScale ?? 1, "none");
    this.initialAngles = [this.ik.baseControl, ...this.ik.controls].map(control => control.angle);
    const tool = this.ik.grip.parent;
    this.toolNode = tool?.name === "hand05" ? tool : null;
    if (this.toolNode) {
      this.toolRest.copy(this.toolNode.quaternion);
      this.toolRestPosition.copy(this.toolNode.position);
      this.toolGripLocal.copy(this.ik.grip.position);
    }
  }

  /**
   * Turn hand05 about its local Y (tool shaft) by `angle` from the export pose, clamped to the roll limit.
   * hand05 is shifted so GripPoint stays exactly where it was: IK/planning (which never see hand05) stay valid,
   * and a held box turns in place about the suction point.
   */
  private setToolRoll(angle: number): void {
    const node = this.toolNode;
    if (!node) return;
    const limit = ROBOT_PICKING.toolRollLimitDegrees * Math.PI / 180;
    this.toolRoll = Math.max(-limit, Math.min(limit, angle));
    toolTurn.setFromAxisAngle(TOOL_AXIS, this.toolRoll);
    node.quaternion.copy(this.toolRest).multiply(toolTurn);
    toolOffset.copy(this.toolGripLocal).applyQuaternion(toolTurn).negate().add(this.toolGripLocal)
      .multiply(node.scale).applyQuaternion(this.toolRest);
    node.position.copy(this.toolRestPosition).add(toolOffset);
    node.updateWorldMatrix(false, true);
  }

  /**
   * Kept for the RobotController API. Planning is no longer budgeted in wall-clock ms per frame: it advances a
   * fixed number of generator steps per second of sim time (takePlanningSteps), so results are speed-independent.
   */
  setPlanningBudget(budget: PlanningBudget | null): void {
    void budget;
  }
  /** Fractional planning-step credit carried between updates, per plan kind. */
  private readonly planCredit = { plan: 0, transfer: 0 };
  /** Generator steps `kind` may run for `delta` seconds of sim time (deterministic; independent of frames). */
  private takePlanningSteps(kind: "plan" | "transfer", delta: number) {
    const rate = kind === "plan" ? IK_CONFIG.planningStepsPerSecond : IK_CONFIG.transferPlanningStepsPerSecond;
    const credit = this.planCredit[kind] + delta * rate, steps = Math.floor(credit);
    this.planCredit[kind] = credit - steps;
    return steps;
  }

  get running() { return this.active; }
  get phase() { return this.runtime.phase; }
  start(): void { if (!this.disposed) this.active = true; }
  pause(): void { this.active = false; }

  private rememberCargo(box: Group): void {
    if (!this.cargo.has(box)) this.cargo.set(box, {
      parent: box.parent, position: box.position.clone(),
      quaternion: box.quaternion.clone(), scale: box.scale.clone(),
    });
  }

  setJointAngle(name: string, degrees: number): void {
    if (this.disposed || !Number.isFinite(degrees)) return;
    if (![this.ik.baseControl, ...this.ik.controls].some(control => control.node.name === name)) return;
    this.pause();
    this.manualAngle = { name, degrees };
  }

  getJointAngles(): JointAngleReading[] {
    const currentIK = this.ik;
    const allControls = [currentIK.baseControl, ...currentIK.controls];
    return allControls.slice()
      .sort((a,b) => a.node.name.localeCompare(b.node.name))
      .map(control => {
        const degrees = control.angle * 180 / Math.PI;
        const windowCenter = Math.round(degrees / 360) * 360;
        const wrist = control.node.name === "hand04";
        const basis = new Quaternion().setFromAxisAngle(new Vector3(1,0,0), -Math.PI/2);
        const world = control.node.getWorldQuaternion(new Quaternion());
        const blenderWorld = basis.clone().invert().multiply(world).multiply(basis);
        const euler = new Euler().setFromQuaternion(blenderWorld, "ZYX");
        const direction = currentIK.grip.getWorldPosition(new Vector3()).sub(control.node.getWorldPosition(new Vector3()));
        return {name:control.node.name, axis:control.dof === "EY" ? "Z" : "X", degrees, locked:control.locked,
          min:Number.isFinite(control.min)?control.min*180/Math.PI:windowCenter-360,
          max:Number.isFinite(control.max)?control.max*180/Math.PI:windowCenter+360,
          setDegrees:(value:number) => {this.setJointAngle(control.node.name, value);},
          worldXYZ:wrist?[euler.x,euler.y,euler.z].map(v=>v*180/Math.PI):undefined,
          downwardTilt:wrist && direction.lengthSq()>1e-12 ? direction.angleTo(new Vector3(0,-1,0))*180/Math.PI : undefined};
      });
  }

  reset(): void {
    if (this.disposed) return;
    this.pause();
    for (const [box, pose] of this.cargo) {
      if (pose.parent) pose.parent.add(box); else box.removeFromParent();
      box.position.copy(pose.position);
      box.quaternion.copy(pose.quaternion);
      box.scale.copy(pose.scale);
      box.updateWorldMatrix(true, true);
    }
    this.ik.collisions.setHeld(null);
    this.ik.setMinimumToolHeight(null);
    this.ik.setContactMode(false);
    this.cargo.clear();
    [this.ik.baseControl, ...this.ik.controls].forEach((control, index) => setJointAngle(control, this.initialAngles[index]));
    this.setToolRoll(0);
    this.runtime = createRuntime();
    this.homePose = null;
    this.manualAngle = null;
    this.model.updateWorldMatrix(true, true);
    this.options.onProgress?.(0, "초기 자세 · 시작 대기");
  }

  dispose(): void {
    if (this.disposed) return;
    this.pause();
    for (const [held, pose] of this.cargo) {
      if (held.parent !== this.ik.grip) continue;
      const parent = pose.parent;
      if (parent) parent.attach(held);
      else {
        held.updateWorldMatrix(true, false);
        held.matrixWorld.decompose(held.position, held.quaternion, held.scale);
        held.removeFromParent();
      }
    }
    this.runtime = createRuntime();
    this.manualAngle = null;
    this.ik.collisions.setHeld(null);
    this.ik.setMinimumToolHeight(null);
    this.cargo.clear();
    this.disposed = true;
  }


  private enter(phase: RobotPhase, job: Transfer): void {
    const r=this.runtime, grip=this.ik.grip;
    r.phase=phase; r.elapsed=0; r.pose=null; r.planning=null; r.recovery=null; r.failures=0; r.retryWait=0; r.lineLock=null;
    r.planWait=0; r.approachAnalytic=false; r.approach=null; r.approachAge=0;
    // Contact phases may dip the upper arm below horizontal (box passing close to the base); LIFT climbs out of it.
    this.ik.setContactMode(phase==="GRASP"||phase==="ATTACH"||phase==="LIFT");
    if(phase==="PRE_GRASP")r.pickupWristStart=this.ik.controls[2].angle;
    grip.getWorldPosition(r.segmentStart);
    r.segmentEnd.copy(r.segmentStart);
    const carryPhase=["SHOULDER_TRANSFER","ALIGN_BASE","TRANSIT","PRE_PLACE"].includes(phase);
    this.ik.setMinimumToolHeight(carryPhase?Math.min(hoverY(job),r.segmentStart.y-MOTION.contactTolerance)
      :["LIFT","RETREAT"].includes(phase)?r.segmentStart.y-MOTION.contactTolerance:null);
    if(phase==="GRASP") r.segmentEnd.y=job.pickup.y;
    if(phase==="LIFT") {
      r.segmentEnd.y=Math.max(r.segmentStart.y+ROBOT_PICKING.preGraspHeight,hoverY(job));
      if(this.transferMode==="shoulder"){
        r.segmentEnd.y=Math.max(r.segmentEnd.y,r.segmentStart.y+ROBOT_PICKING.rearLiftHeight);
        // Retract in the current arm plane, keeping hand00 fixed as cargo clears the belt.
        this.ik.baseControl.node.getWorldPosition(r.point);
        r.point.sub(r.segmentStart).setY(0);
        r.command.copy(this.ik.controls[0].axis).transformDirection(this.ik.controls[0].node.matrixWorld).setY(0).normalize();
        r.point.addScaledVector(r.command,-r.point.dot(r.command));
        const distance=ROBOT_PICKING.liftRearwardDistance;
        if(r.point.lengthSq()>1e-12)r.segmentEnd.addScaledVector(r.point.normalize(),distance);
        const hover=job.destination.clone();hover.y=hoverY(job);
        r.preparedShoulder=null;
        r.transferPlanning=this.ik.prepareShoulderTransfer(r.segmentEnd,hover,job.destination);
      }
    }
    if(phase==="PLACE") {
      job.box.getWorldPosition(r.point);
      r.gripOffset.copy(r.segmentStart).sub(r.point);
      r.segmentEnd.y=job.destination.y+r.gripOffset.y;
    }
    if(phase==="RETREAT") r.segmentEnd.y=Math.max(r.segmentEnd.y+ROBOT_PICKING.retreatHeight,(job.clearanceY??-Infinity)+r.gripOffset.y);
    const loaded=job.box.parent===grip;
    r.duration=Math.max(0.1,r.segmentEnd.distanceTo(r.segmentStart)/ROBOT_PICKING.verticalSpeed*1.875/(loaded?ROBOT_PICKING.loadedSpeedScale:1));
    if(phase==="PRE_PLACE") {
      job.box.getWorldPosition(r.releasePosition);
      job.box.getWorldQuaternion(r.releaseRotation);
      r.destinationRotation.setFromAxisAngle(new Vector3(0,1,0),job.yaw??0);
      // A rectangular box occupies the same slot after a half turn about Y.
      r.rotation.setFromAxisAngle(new Vector3(0,1,0),(job.yaw??0)+Math.PI);
      if(r.releaseRotation.angleTo(r.rotation)<r.releaseRotation.angleTo(r.destinationRotation))r.destinationRotation.copy(r.rotation);
      if(this.toolNode){
        // hand05 carries the box yaw: twist of (destination * release^-1) about world Y, mapped onto the tool axis.
        toolTurn.copy(r.destinationRotation).multiply(toolInverse.copy(r.releaseRotation).invert());
        const yaw=wrapAngle(2*Math.atan2(toolTurn.y,toolTurn.w));
        toolAxisWorld.copy(TOOL_AXIS).transformDirection(this.toolNode.matrixWorld);
        const sign=toolAxisWorld.y>=0?1:-1,limit=ROBOT_PICKING.toolRollLimitDegrees*Math.PI/180;
        let goal=this.toolRoll+sign*yaw;
        if(Math.abs(goal)>limit){
          // Past the roll stop: use the half-turn-equivalent slot orientation, turning the other way.
          goal-=Math.sign(goal)*Math.PI;
          r.destinationRotation.premultiply(toolTurn.setFromAxisAngle(TOOL_AXIS,Math.PI));
        }
        this.toolRollFrom=this.toolRoll;this.toolRollGoal=goal;
      }
      r.duration=Math.max(ROBOT_PICKING.releaseSeconds,
        r.releaseRotation.angleTo(r.destinationRotation)*1.875/ROBOT_PICKING.releaseAngularSpeed);
    }
    if(phase==="RELEASE") {
      job.box.getWorldPosition(r.releasePosition);
      job.box.getWorldQuaternion(r.releaseRotation);
      r.duration=ROBOT_PICKING.releaseSeconds;
      if(r.parent)r.parent.attach(job.box);
      else {
        const scale=job.box.getWorldScale(new Vector3());
        job.box.removeFromParent(); job.box.position.copy(r.releasePosition);
        job.box.quaternion.copy(r.releaseRotation); job.box.scale.copy(scale);
      }
      this.ik.collisions.setHeld(null);
    }
    const label=phase==="LIFT"&&this.transferMode==="shoulder"
      ?"hand00 고정 · 상승하며 후퇴 · 후방 경로 계산":PHASE_LABELS[phase];
    this.options.onProgress?.(r.index,`${phase} · ${label}`);
  }

  private planFromCurrent(target: Vector3, job: Transfer, linear: boolean) {
    const r=this.runtime,ik=this.ik;
    if(r.phase==="PRE_GRASP"&&r.index===0)return r.pickupWristRange
      ?ik.startConstrainedPlan(target,{wristAbovePoint:true,wristRange:r.pickupWristRange})
      :ik.startPickupPlan(target);
    if(r.phase==="TRANSIT"&&this.transferMode==="base")return ik.startBaseTransfer(target,job.destination);
    if(r.phase==="SHOULDER_TRANSFER"){
      const hover=job.destination.clone();hover.y=hoverY(job);
      return ik.startShoulderTransfer(hover,job.destination,r.preparedShoulder??undefined);
    }
    if(r.phase==="ALIGN_BASE")return ik.startBaseAlignment(job.destination);
    const fixedBase=r.phase==="LIFT"?r.transportBaseYaw
      :["PRE_PLACE","PLACE","RETREAT"].includes(r.phase)?ik.baseControl.angle:undefined;
    return (linear?ik.startCartesianPlan:ik.startConstrainedPlan)(target,{baseYaw:fixedBase,wristAbovePoint:BEFORE_PICK.includes(r.phase)});
  }

  private moveTo(target: Vector3, job: Transfer, delta: number, linear=false): boolean {
    const r=this.runtime, ik=this.ik;
    const tracking=job.moving&&BEFORE_PICK.includes(r.phase);
    const settled=(pose:IKPose)=>linear?ik.isCartesianSettled(pose):tracking?ik.isSettled(pose):ik.isEasedSettled(pose);
    if(!["SHOULDER_TRANSFER","ALIGN_BASE"].includes(r.phase)&&r.pose&&settled(r.pose)&&r.target.distanceTo(target)>MOTION.contactTolerance/4&&!this.handoffReady(target,tracking)){r.pose=null;r.planning=null;}
    if(!r.pose){
      // Carry plans are solved live: the closed-form IK makes the place-pose cache unnecessary.
      if(!r.planning){
        r.target.copy(target);
        job.onPlanEvent?.({state:"searching",reason:`${r.phase} · 손목 상향 위치와 회전 경로 계산`,phase:"precise"});
        const goal=r.target.clone();
        const replan=()=>this.planFromCurrent(goal,job,linear);
        const planStart=profileStart();
        if(r.recovery){
          const fixedBase=["LIFT","SHOULDER_TRANSFER"].includes(r.phase)?ik.baseControl.angle:undefined;
          r.planning=ik.startCollisionRecovery(r.recovery,fixedBase,r.phase==="ALIGN_BASE",replan,r.phase==="SHOULDER_TRANSFER"?undefined:goal);
        }else r.planning=replan();
        profileEnd("ik",planStart);
      }
      const cached=(r.recovery?null:r.phase==="ALIGN_BASE"?r.alignment:r.phase==="TRANSIT"?r.transit:null);
      let pose=cached;
      if(!pose){
        const budget=this.takePlanningSteps("plan",delta);
        // No planning time left this frame (another robot's turn or a later sub-step): keep waiting.
        if(budget<=0||!r.planning)return false;
        const ikStart=profileStart();
        pose=ik.advancePlanSteps(r.planning,budget);
        profileEnd("ik",ikStart);
      }
      if(!pose)return false;
      r.planning=null;r.pose=pose;
      if(pose.reachable&&r.phase==="PRE_GRASP"&&r.index===0&&!r.pickupWristRange){
        const wrist=ik.controls[2];
        r.pickupWristRange=pose.angles[2]<r.pickupWristStart?[wrist.min,r.pickupWristStart]:[r.pickupWristStart,wrist.max];
      }
      if(pose.alignment)r.alignment=pose.alignment;
      if(pose.transit)r.transit=pose.transit;
      if(pose.target)r.target.copy(pose.target);
      if(!pose.reachable){
        if(!r.recovery&&job.box.parent===ik.grip&&pose.blockedBy?.includes("hand03")){
          r.recovery=pose;r.pose=null;r.alignment=null;r.transit=null;
          this.options.onProgress?.(r.index,`${r.phase} · 박스/hand03 간섭 · 현재 각도에서 양방향 재계산`);
          return false;
        }
        r.failures++;r.retryWait=0;
        job.onPlanEvent?.({state:"rejected",reason:pose.blockedBy??"관절 경로 미발견",phase:"precise"});
        this.options.onProgress?.(r.index,`${r.phase} · ${pose.blockedBy??"관절 경로 미발견"}`);
        return false;
      }
      job.onPlanEvent?.({state:"ready",reason:`${r.phase} · 경유점 계산 완료`,phase:"precise"});
    }
    if(!r.pose.reachable){
      // Tracking phases re-plan as the box moves; others would wait forever on a rejected plan.
      if(tracking)return false;
      r.retryWait+=delta;
      if(r.retryWait<RETRY.waitSeconds)return false;
      r.pose=null;r.planning=null;r.retryWait=0;
      if(r.failures>=RETRY.abortAfter&&job.box.parent!==ik.grip){this.abandon(job);return false;}
      // Repeated rejections: drop the carry height floor for this phase and plan once more.
      if(r.failures>=RETRY.relaxAfter)ik.setMinimumToolHeight(null);
      return false;
    }
    const moved=(!r.recovery&&(linear||tracking))?ik.animate(r.pose,delta):ik.animateEased(r.pose,delta,
      job.box.parent===ik.grip?ROBOT_PICKING.loadedSpeedScale:1);
    if(!moved){
      if(job.box.parent===ik.grip&&ik.lastMotionBlock?.includes("hand03")){
        r.recovery={...r.pose,route:undefined,step:undefined};
        r.alignment=null;r.transit=null;
        this.options.onProgress?.(r.index,`${r.phase} · 박스/hand03 충돌 예상 · 현재 각도에서 반대 방향 재계산`);
      }
      r.pose=null;r.planning=null;return false;
    }
    const reached=(r.recovery?ik.isEasedSettled(r.pose):settled(r.pose))&&ik.grip.getWorldPosition(r.point).distanceTo(r.target)<MOTION.contactTolerance;
    // A moving box never waits for the planner: PRE_GRASP hands over to GRASP tracking once close enough.
    if(tracking&&reached&&r.point.distanceTo(target)>=(r.phase==="PRE_GRASP"?ROBOT_PICKING.trackHandoffTolerance:MOTION.contactTolerance)){r.pose=null;return false;}
    if(reached)r.recovery=null;
    return reached;
  }

  /** Settled PRE_GRASP close enough to the (moving) hover point to continue with analytic GRASP tracking. */
  private handoffReady(target: Vector3, tracking: boolean | undefined): boolean {
    const r=this.runtime;
    return Boolean(tracking)&&r.phase==="PRE_GRASP"&&this.ik.grip.getWorldPosition(r.point).distanceTo(target)<ROBOT_PICKING.trackHandoffTolerance;
  }

  /** Where a moving box will be when the arm gets there: lead = planning latency + tool travel time (sim s). */
  private predictIntercept(point: Vector3, velocity: Vector3): void {
    const distance=this.ik.grip.getWorldPosition(this.runtime.point).distanceTo(point);
    const lead=Math.min(ROBOT_PICKING.interceptMaxLead,ROBOT_PICKING.interceptLatency+distance/ROBOT_PICKING.interceptToolSpeed);
    point.addScaledVector(velocity,lead);
  }

  /**
   * GRASP/ATTACH on a moving box: closed-form tracking of `target` every sub-step (no planner, no budget),
   * hand00 following the belt on the locked branch. Returns whether GripPoint is within grasp tolerance, or null
   * when tracking is not possible (the caller falls back to the planner for the rest of the phase).
   */
  private trackPick(target: Vector3, delta: number): boolean | null {
    const r=this.runtime,ik=this.ik;
    if(r.lineLock===false)return null;
    r.lineLock??=ik.lineLock()??false;
    const pose=r.lineLock?ik.solveTrack(target,r.lineLock):null;
    if(!pose||!ik.animate(pose,delta)){r.lineLock=false;r.pose=null;r.planning=null;return null;}
    r.pose=null;r.planning=null;r.target.copy(target);
    ik.grip.getWorldPosition(r.point);
    return Math.hypot(r.point.x-target.x,r.point.z-target.z)<=ROBOT_PICKING.graspHorizontalTolerance
      &&r.point.distanceTo(target)<=ROBOT_PICKING.graspTolerance;
  }

  /**
   * PRE_GRASP on a moving box when planning is too slow in sim time (high speed, shared budget): closed-form
   * approach toward the predicted hover point, re-solved every approachResolveSeconds. Null = use the planner.
   */
  private approachMoving(target: Vector3, delta: number): boolean | null {
    const r=this.runtime,ik=this.ik;
    if(!r.approachAnalytic){
      if(r.pose||r.recovery)return null;
      r.planWait+=delta;
      if(r.planWait<ROBOT_PICKING.approachPlanTimeout)return null;
      r.approachAnalytic=true;r.planning=null;r.approach=null;
    }
    r.approachAge+=delta;
    if(!r.approach||r.approachAge>=ROBOT_PICKING.approachResolveSeconds){r.approach=ik.solveApproach(target);r.approachAge=0;}
    if(!r.approach||!ik.animate(r.approach,delta)){
      // No closed-form approach (or blocked): back to the planner, which restarts its wait.
      r.approachAnalytic=false;r.approach=null;r.planWait=0;r.pose=null;r.planning=null;
      return null;
    }
    r.target.copy(target);
    return ik.grip.getWorldPosition(r.point).distanceTo(target)<ROBOT_PICKING.trackHandoffTolerance;
  }

  private moveVertical(job: Transfer, delta: number): boolean {
    const r=this.runtime;
    if(!r.recovery&&(!r.pose||this.ik.isCartesianSettled(r.pose)))r.elapsed=Math.min(r.duration,r.elapsed+delta);
    const progress=minimumJerk(r.elapsed/r.duration);
    r.command.copy(r.segmentStart).lerp(r.segmentEnd,progress);
    if(r.phase==="GRASP"){
      // X/Z track the moving belt; descent remains vertical in the box frame.
      r.command.x=job.pickup.x;r.command.z=job.pickup.z;
      r.command.y=job.pickup.y+(r.segmentStart.y-r.segmentEnd.y)*(1-progress);
    }
    const tracked=r.phase==="GRASP"&&job.moving&&!r.recovery?this.trackPick(r.command,delta):null;
    const reached=tracked!==null?tracked
      :r.phase!=="GRASP"&&!r.recovery&&r.lineLock!==false?this.followLine(job,delta):this.moveTo(r.command,job,delta,true);
    if(r.phase==="PLACE"){
      job.box.getWorldPosition(r.point);
      setCargoWorldPose(job.box,this.ik.grip,r.point,r.destinationRotation);
    }
    return reached&&r.elapsed>=r.duration;
  }

  /**
   * Vertical MoveL with hand00 fixed: every frame solves the commanded point in closed form on the branch and
   * tool pitch the segment started with, so hand01/02/04 follow one smooth curve. Any miss (reach, limits,
   * jump, collision) hands the rest of the segment to the planner; solvers never alternate within a segment.
   */
  private followLine(job: Transfer, delta: number): boolean {
    const r=this.runtime,ik=this.ik;
    r.lineLock??=ik.lineLock()??false;
    const pose=r.lineLock?ik.solveLine(r.command,r.lineLock):null;
    if(!pose||!ik.animate(pose,delta)){
      if(pose)ikSolveStats.lineBlocked++;
      r.lineLock=false;r.pose=null;r.planning=null;
      return this.moveTo(r.command,job,delta,true);
    }
    r.planning=null;r.pose=pose;r.target.copy(r.command);
    return ik.isCartesianSettled(pose)&&ik.grip.getWorldPosition(r.point).distanceTo(r.command)<MOTION.contactTolerance;
  }

  private attach(job: Transfer): void {
    const r=this.runtime, ik=this.ik;
    r.parent=job.box.parent;
    ik.grip.attach(job.box); // Preserve world position; no pickup snap.
    job.box.quaternion.normalize();
    ik.collisions.setHeld(job.box);
    r.transportBaseYaw=ik.baseControl.angle;
    job.onPick?.();
    this.enter("LIFT",job);
  }

  /** Give an un-picked job back to the factory (box keeps moving, slot is released). */
  private abandon(job: Transfer): void {
    const r=this.runtime;
    this.cargo.delete(job.box);job.onMiss?.();r.index++;r.phase="HOME";r.pose=null;r.planning=null;r.recovery=null;r.failures=0;
    this.options.onProgress?.(r.index,"HOME · 경로 반복 실패로 작업 반환");
  }

  private release(job: Transfer, delta: number): void {
    const r=this.runtime;
    r.elapsed=Math.min(r.duration,r.elapsed+delta);
    const progress=minimumJerk(r.elapsed/r.duration);
    r.command.copy(r.releasePosition).lerp(job.destination,progress);
    setCargoWorldPose(job.box,r.parent,r.command,r.releaseRotation);
    if(r.elapsed<r.duration)return;
    job.onPlace?.();this.cargo.delete(job.box);
    this.enter("RETREAT",job);
  }

  /**
   * hand00 is continuous. Only while the automatic controller is at rest (HOME, no
   * plan/route/recovery, nothing held) subtract whole turns so the angle stays in
   * [-pi, pi]. The world pose is identical, so nothing visibly moves.
   */
  private wrapBaseAtRest(): boolean {
    const r=this.runtime,base=this.ik.baseControl;
    if(r.phase!=="HOME"||r.pose||r.planning||r.recovery||r.transferPlanning||this.manualAngle)return false;
    if(Number.isFinite(base.min)||Number.isFinite(base.max))return false;
    const turns=Math.round(base.angle/(2*Math.PI));
    if(!turns)return false;
    setJointAngle(base,base.angle-turns*2*Math.PI);
    this.model.updateWorldMatrix(true,true);
    r.alignment=null;r.transit=null;r.preparedShoulder=null;
    return true;
  }

  update(delta: number): void {
    if(this.disposed||!Number.isFinite(delta)||delta<0)return;
    const r=this.runtime, ik=this.ik;
    if(this.manualAngle){
      const request=this.manualAngle;
      const control=[ik.baseControl,...ik.controls].find(joint=>joint.node.name===request.name);
      if(control)setJointAngle(control,request.degrees*Math.PI/180);
    this.model.updateWorldMatrix(true,true);r.pose=null;r.planning=null;r.recovery=null;r.alignment=null;r.transit=null;r.transferPlanning=null;r.preparedShoulder=null;this.manualAngle=null;
    }
    if(!this.running)return;
    const dt=Math.min(delta,MOTION.maxDelta);
    const job=this.options.getJobs()[r.index];
    // Unwind hand05 whenever nothing is held (GripPoint stays fixed, so this never disturbs a plan).
    if(this.toolRoll!==0&&(!job||job.box.parent!==ik.grip)&&r.phase!=="PRE_PLACE"){
      const step=ROBOT_PICKING.releaseAngularSpeed*dt;
      this.setToolRoll(Math.abs(this.toolRoll)<=step?0:this.toolRoll-Math.sign(this.toolRoll)*step);
    }
    if(!job){
      if(r.phase==="HOME"){
        // hand00 is continuous: return to the initial heading by the nearest equivalent
        // angle instead of unwinding every turn accumulated by earlier jobs.
        const base=ik.baseControl,initialYaw=this.initialAngles[0];
        const homeYaw=Number.isFinite(base.min)||Number.isFinite(base.max)?initialYaw
          :homeHeading(base.angle,initialYaw);
        this.homePose??={baseYaw:homeYaw,angles:this.initialAngles.slice(1),error:0,reachable:true};
        ik.setMinimumToolHeight(null);
        ik.animateEased(this.homePose,dt);
        // At rest at home: fold accumulated hand00 turns back into [-pi, pi].
        if(ik.isEasedSettled(this.homePose)&&this.wrapBaseAtRest())this.homePose=null;
      }
      return;
    }
    this.homePose=null;
    if(r.phase==="HOME"){
      if(job.available&&!job.available()){job.onMiss?.();r.index++;return;}
      this.model.getWorldPosition(this.origin);
      if(!isPickupInRange(this.origin,job.pickup,job.moving?job.velocity:undefined,this.pickupRadius,MOTION.predictionSeconds))return;
      r.alignment=null;r.transit=null;
      // No plan or route is active yet, so wrapping cannot alter a planned detour.
      this.wrapBaseAtRest();
      this.rememberCargo(job.box);this.enter("PRE_GRASP",job);
    }
    if(BEFORE_PICK.includes(r.phase)&&job.available&&!job.available()){
      this.cargo.delete(job.box);job.onMiss?.();r.index++;r.phase="HOME";r.pose=null;r.planning=null;return;
    }
    if(r.phase==="PRE_GRASP"&&job.moving&&job.velocity){
      // The box will leave the pickup radius before the arm can be on it: give it back now instead of chasing.
      this.model.getWorldPosition(this.origin);
      if(!isPickupInRange(this.origin,job.pickup,job.velocity,this.pickupRadius,ROBOT_PICKING.abortLeadSeconds)){
        this.options.onProgress?.(r.index,"PRE_GRASP · 예상 접점이 도달 범위를 벗어남 · 작업 반환");
        this.abandon(job);return;
      }
    }
    if(r.phase==="RELEASE"){this.release(job,dt);return;}
    if(r.transferPlanning&&["LIFT","SHOULDER_TRANSFER"].includes(r.phase)){
      const budget=this.takePlanningSteps("transfer",dt);
      const ikStart=profileStart();
      const prepared=budget>0?ik.advancePlanSteps(r.transferPlanning,budget):null;
      profileEnd("ik",ikStart);
      if(prepared){r.preparedShoulder=prepared;r.transferPlanning=null;}
    }
    if(r.phase==="SHOULDER_TRANSFER"&&r.transferPlanning)return;
    if(r.phase==="ATTACH"){
      const tracked=job.moving&&!r.recovery?this.trackPick(job.pickup,dt):null;
      const contact=tracked!==null?tracked:this.moveTo(job.pickup,job,dt,true);
      if(contact&&isWristAboveBox(ik.controls[2].node,job.box))r.elapsed+=dt;
      else r.elapsed=0;
      if(r.elapsed>=ROBOT_PICKING.graspHoldSeconds)this.attach(job);
      return;
    }
    if(r.phase==="PRE_PLACE"){
      r.elapsed=Math.min(r.duration+MOTION.contactHold,r.elapsed+dt);
      const progress=minimumJerk(Math.min(1,r.elapsed/r.duration));
      r.rotation.copy(r.releaseRotation).slerp(r.destinationRotation,progress);
      // hand05 turns with the box; the cargo pose below stays authoritative (absorbs residual tool tilt).
      this.setToolRoll(this.toolRollFrom+(this.toolRollGoal-this.toolRollFrom)*progress);
      setCargoWorldPose(job.box,ik.grip,r.releasePosition,r.rotation);
      if(r.elapsed>=r.duration+MOTION.contactHold)this.enter("PLACE",job);
      return;
    }
    let reached: boolean;
    if(LINEAR_PHASES.includes(r.phase))reached=this.moveVertical(job,dt);
    else {
      r.command.copy(job.pickup);
      if(r.phase==="PRE_GRASP"){
        r.command.y+=ROBOT_PICKING.preGraspHeight;
        if(job.moving&&job.velocity)this.predictIntercept(r.command,job.velocity);
      }
      else if(r.phase==="TRANSIT"){
        r.command.copy(job.destination);r.command.y=hoverY(job);
      }
      const fast=r.phase==="PRE_GRASP"&&job.moving?this.approachMoving(r.command,dt):null;
      reached=fast!==null?fast:this.moveTo(r.command,job,dt);
    }
    if(!reached)return;
    if(r.phase==="LIFT"){
      this.enter(this.transferMode==="base"?"TRANSIT":"SHOULDER_TRANSFER",job);
      return;
    }
    const next: Partial<Record<RobotPhase,RobotPhase>>={
      PRE_GRASP:"GRASP",GRASP:"ATTACH",
      SHOULDER_TRANSFER:"ALIGN_BASE",ALIGN_BASE:"TRANSIT",TRANSIT:"PRE_PLACE",PLACE:"RELEASE",
    };
    if(r.phase==="RETREAT"){
      r.index++;r.phase="HOME";r.pose=null;r.planning=null;
      this.options.onProgress?.(r.index,"RETREAT 완료 · 다음 박스 준비");
    }else {
      const phase=next[r.phase];if(phase)this.enter(phase,job);
    }
  }
}
