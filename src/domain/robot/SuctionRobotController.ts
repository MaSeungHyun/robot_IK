import { minimumJerk } from "@/domain/robot/ik/motionTiming";
import { profileEnd, profileStart } from "@/lib/profiler/frameProfiler";
import { Euler, Group, MathUtils, Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import { BOX_SIZES, MOTION, IK_CONFIG, ROBOT_PICKING } from "@/constants/simulation";
import type { RobotController, RobotControllerOptions } from "@/domain/robot/RobotController";
import type { JointAngleReading, RobotPhase, RobotTransferMode, Transfer } from "@/types/robot";
import { createRobotIK, ikSolveStats, type IKPose, type LineLock } from "@/domain/robot/ik/robotIK";
import type { PlanningBudget } from "@/domain/robot/ik/planningScheduler";
import { poseRobotHome, setJointAngle } from "@/domain/robot/ik/joints";
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
  /** Sim seconds spent in the current phase (watchdog: an unsolvable pick is given back, an unsolvable LIFT is skipped). */
  phaseTime: 0,
  /** Straight-segment lock (LIFT/PLACE/RETREAT): analytic branch+pitch; false = this segment uses the planner. */
  lineLock: null as LineLock | null | false,
  /** PRE_GRASP on a moving box: sim seconds spent waiting for the planner, and the closed-form approach in use. */
  planWait: 0, approachAnalytic: false, approach: null as IKPose | null, approachAge: 0,
  snapStart: new Vector3(), snapEnd: new Vector3(), snapTime: Infinity,
  releasePosition: new Vector3(), releaseRotation: new Quaternion(), destinationRotation: new Quaternion(), rotation: new Quaternion(),
  /** Carry box turn (after ALIGN_BASE, before TRANSIT): in-gripper yaw pre-set so the box arrives square to the slot. */
  boxTurn: false, boxTurnFrom: new Quaternion(), boxTurnTo: new Quaternion(), boxTurnDuration: 0, boxTurnElapsed: 0,
});
const PHASE_LABELS: Record<RobotPhase,string> = {
  HOME:"다음 박스 대기", PRE_GRASP:"박스 위 경유점으로 접근", GRASP:"박스 위에서 수직 하강",
  ATTACH:"집기 접촉 확인", LIFT:"hand00 고정 · 수직 상승", RESTORE_SHOULDER:"hand00 고정 · hand01 크게 들어 올림",
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
/** Between-job moves: next pick planned straight from the last pose (chained / after waiting) vs from HOME. */
export const robotChainStats = { chained: 0, fromHome: 0, homeIdle: 0, homeHolding: 0, baseTurnAfterRaise: 0, boxTurnAfterAlign: 0 };
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
  /** "chain" right after a place: the next pick is planned from the current pose; "home" once sent back to HOME. */
  private idle: "chain" | "home" = "home";
  /** Holding a box at HOME until its destination can take it. */
  private heldAtHome = false;
  /** Base-transfer carry after LIFT: the ㄱ→> raise runs first, then a pure hand00 turn (ALIGN_BASE), then TRANSIT. */
  private carryOrder: "raise" | null = null;
  private runtime = createRuntime();
  private manualAngle: { name: string; degrees: number } | null = null;
  private readonly cargo = new Map<Group, CargoPose>();
  private readonly origin = new Vector3();
  private readonly contact = new Vector3();
  private readonly pickupRadius: number;

  private readonly options: RobotControllerOptions;

  constructor(options: RobotControllerOptions) {
    this.options = options;
    this.id = options.id;
    this.model = options.model;
    this.transferMode = options.transferMode ?? ROBOT_PICKING.transferMode;
    this.pickupRadius = options.pickupRadius ?? ROBOT_PICKING.radius;
    if (!Number.isFinite(this.pickupRadius) || this.pickupRadius <= 0) throw new Error("Pickup radius must be positive");
    poseRobotHome(this.model);
    this.ik = createRobotIK(this.model, "none");
    this.initialAngles = [this.ik.baseControl, ...this.ik.controls].map(control => control.angle);
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
  start(): void {
    if (this.disposed) return;
    this.ik.setKeepOut(this.options.getKeepOut?.() ?? []);
    this.active = true;
  }
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
    r.boxTurn=false;
    r.phase=phase; r.elapsed=0; r.pose=null; r.planning=null; r.recovery=null; r.failures=0; r.retryWait=0; r.lineLock=null; r.phaseTime=0;
    r.planWait=0; r.approachAnalytic=false; r.approach=null; r.approachAge=0;
    // Contact phases may dip the upper arm below horizontal (box passing close to the base); LIFT climbs out of it.
    this.ik.setContactMode(phase==="GRASP"||phase==="ATTACH"||phase==="LIFT");
    // Loaded joint-space moves: per-tick hand04 compensation keeps the held box level (tool straight down).
    this.ik.setToolLevel(phase==="RESTORE_SHOULDER"||phase==="SHOULDER_TRANSFER"||phase==="ALIGN_BASE"||phase==="TRANSIT");
    if(phase==="PRE_GRASP")r.pickupWristStart=this.ik.controls[2].angle;
    grip.getWorldPosition(r.segmentStart);
    r.segmentEnd.copy(r.segmentStart);
    const carryPhase=["SHOULDER_TRANSFER","ALIGN_BASE","TRANSIT","PRE_PLACE"].includes(phase);
    this.ik.setMinimumToolHeight(phase==="RESTORE_SHOULDER"?r.segmentStart.y-MOTION.contactTolerance:carryPhase?Math.min(hoverY(job),r.segmentStart.y-MOTION.contactTolerance)
      :["LIFT","RETREAT"].includes(phase)?r.segmentStart.y-MOTION.contactTolerance:null);
    if(phase==="GRASP") r.segmentEnd.y=job.pickup.y;
    if(phase==="LIFT") {
      r.segmentEnd.y=Math.max(r.segmentStart.y+ROBOT_PICKING.preGraspHeight+ROBOT_PICKING.pickLiftExtra,hoverY(job));
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
      this.graspPoint(job,r.point);r.command.x=r.point.x;r.command.z=r.point.z;
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
    // PLACE: hand04 world-vertical for the whole put-down (box released in that pose)
    r.lineLock??=ik.lineLock(r.phase==="PLACE")??false;
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
    r.snapTime=Infinity;
    if(!ROBOT_PICKING.centerGrasp){ // legacy off-centre contact: slide the box under the cup
      ik.grip.getWorldPosition(r.snapEnd).sub(job.pickup).setY(0);
      job.box.getWorldPosition(r.snapStart).add(r.snapEnd);
      r.snapEnd.copy(ik.grip.worldToLocal(r.snapStart));
      r.snapStart.copy(job.box.position);
      r.snapTime=r.snapStart.distanceToSquared(r.snapEnd)>1e-8?0:Infinity;
    }
    ik.collisions.setHeld(job.box);
    r.transportBaseYaw=ik.baseControl.angle;
    job.onPick?.();
    this.enter("LIFT",job);
  }

  /** Give an un-picked job back to the factory (box keeps moving, slot is released). */
  private abandon(job: Transfer, reason="HOME · 경로 반복 실패로 작업 반환"): void {
    const r=this.runtime;
    this.cargo.delete(job.box);job.onMiss?.();r.index++;r.phase="HOME";r.pose=null;r.planning=null;r.recovery=null;r.failures=0;
    this.options.onProgress?.(r.index,reason);
  }

  /** Suction contact: the exact centre of the box top face (job.pickup). */
  private graspPoint(job: Transfer, out: Vector3): Vector3 {
    out.copy(job.pickup);
    if(ROBOT_PICKING.centerGrasp)return out;
    const snap=ROBOT_PICKING.suctionSnap;
    this.model.getWorldPosition(this.origin);
    const dx=out.x-this.origin.x,dz=out.z-this.origin.z,d=Math.hypot(dx,dz),shift=d-snap.reach;
    if(shift<=0)return out;
    const ax=new Vector3(1,0,0),az=new Vector3(0,0,1);
    job.box.getWorldQuaternion(this.runtime.rotation);
    ax.applyQuaternion(this.runtime.rotation).setY(0).normalize();az.applyQuaternion(this.runtime.rotation).setY(0).normalize();
    const ox=-dx/d*shift,oz=-dz/d*shift,hx=Math.max(0,BOX_SIZES[0].x/2-snap.margin),hz=Math.max(0,BOX_SIZES[0].z/2-snap.margin);
    const u=MathUtils.clamp(ox*ax.x+oz*ax.z,-hx,hx),v=MathUtils.clamp(ox*az.x+oz*az.z,-hz,hz);
    out.x+=u*ax.x+v*az.x;out.z+=u*ax.z+v*az.z;
    return out;
  }

  /** Lifted: base transfers first bring hand01 back to its home angle (when not already there), then TRANSIT. */
  private afterLift(job: Transfer): void {
    if(this.transferMode!=="base"){this.enter("SHOULDER_TRANSFER",job);return;}
    // ㄱ→> raise first; afterRestore then turns only hand00 before the remaining arm moves.
    this.carryOrder="raise";
    this.enter("RESTORE_SHOULDER",job);
  }


  /**
   * RESTORE_SHOULDER: hand00 fixed, hand01 eased to its home angle while hand02/hand04 keep the held box at or
   * above its lifted height and at the same tool pitch. No such pose / blocked / timeout: continue to TRANSIT.
   */
  private restoreShoulder(job: Transfer, delta: number): void {
    const r=this.runtime,ik=this.ik;
    if(!r.pose){
      r.planning??=ik.startShoulderRestore(this.initialAngles[1],r.segmentStart.y-MOTION.contactTolerance,MathUtils.degToRad(ROBOT_PICKING.liftShoulderRaiseDegrees),ROBOT_PICKING.liftInwardToleranceM,ROBOT_PICKING.liftPathSamples,MathUtils.degToRad(ROBOT_PICKING.liftElbowRaiseDegrees));
      const budget=this.takePlanningSteps("plan",delta);
      if(budget<=0)return;
      const pose=ik.advancePlanSteps(r.planning,budget);
      if(!pose)return;
      r.planning=null;
      if(!pose.reachable){
        this.options.onProgress?.(r.index,`RESTORE_SHOULDER · ${pose.blockedBy??"자세 없음"} · 현재 자세로 이송`);
        this.afterRestore(job);return;
      }
      r.pose=pose;
    }
    const moved=ik.animateEased(r.pose,delta,ROBOT_PICKING.loadedSpeedScale);
    if(!moved||r.phaseTime>MOTION.approachTimeout){this.afterRestore(job);return;}
    if(ik.isEasedSettled(r.pose))this.afterRestore(job);
  }
  /** After the ㄱ→> raise: pure hand00 turn (ALIGN_BASE, only joint 0 moves), then TRANSIT. */
  private afterRestore(job: Transfer): void {
    if(this.carryOrder==="raise"){this.carryOrder=null;robotChainStats.baseTurnAfterRaise++;this.enter("ALIGN_BASE",job);return;}
    this.enter("TRANSIT",job);
  }

  /**
   * After the ??> raise and the hand00 turn: turn the held box about the suction point (tool stays vertical) so that,
   * after the base rotation still left for TRANSIT, it reaches the slot at job.yaw (or the equivalent half turn).
   * PRE_PLACE then only corrects any residual. False: nothing to turn (continue to TRANSIT).
   */
  private startBoxTurn(job: Transfer): boolean {
    const r=this.runtime,ik=this.ik;
    if(job.box.parent!==ik.grip)return false;
    const base=ik.baseControl.node.getWorldPosition(new Vector3());
    const from=ik.grip.getWorldPosition(new Vector3()).sub(base),to=job.destination.clone().sub(base);
    // Remaining base yaw (about +Y) from the current grip heading to the slot heading.
    const remaining=from.x*from.x+from.z*from.z>1e-8&&to.x*to.x+to.z*to.z>1e-8
      ?Math.atan2(from.z*to.x-from.x*to.z,from.x*to.x+from.z*to.z):0;
    job.box.getWorldPosition(r.releasePosition);
    job.box.getWorldQuaternion(r.boxTurnFrom);
    const up=new Vector3(0,1,0);
    r.boxTurnTo.setFromAxisAngle(up,(job.yaw??0)-remaining);
    r.rotation.setFromAxisAngle(up,(job.yaw??0)+Math.PI-remaining);
    if(r.boxTurnFrom.angleTo(r.rotation)<r.boxTurnFrom.angleTo(r.boxTurnTo))r.boxTurnTo.copy(r.rotation);
    const angle=r.boxTurnFrom.angleTo(r.boxTurnTo);
    if(angle<1e-3)return false;
    r.boxTurnDuration=Math.max(ROBOT_PICKING.releaseSeconds,angle*1.875/ROBOT_PICKING.releaseAngularSpeed);
    r.boxTurnElapsed=0;r.boxTurn=true;robotChainStats.boxTurnAfterAlign++;
    return true;
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
    if(!job){
      // No next box: straight back to HOME.
      if(r.phase==="HOME"){
        if(this.idle!=="home"){this.idle="home";robotChainStats.homeIdle++;}
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
      if(this.idle==="home")robotChainStats.fromHome++;else robotChainStats.chained++;
      this.idle="home";
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
    r.phaseTime+=dt;
    if(r.phaseTime>MOTION.approachTimeout&&job.box.parent!==ik.grip&&(r.phase==="PRE_GRASP"||r.phase==="GRASP")){
      // The arm never got onto the box (IK/pose not solvable there): give the job back instead of freezing.
      this.model.getWorldPosition(this.origin);
      const d=Math.hypot(job.pickup.x-this.origin.x,job.pickup.z-this.origin.z);
      this.abandon(job,`손이 닿지 않음: ${d.toFixed(2)} m · ${r.phase} ${MOTION.approachTimeout}s 동안 자세 해 없음 · 작업 반환`);return;
    }
    if(r.phaseTime>MOTION.approachTimeout&&job.box.parent===ik.grip&&r.phase==="LIFT"){
      // Holding the box but the straight lift has no down-facing solution: continue with the carry planner.
      this.options.onProgress?.(r.index,"LIFT 해 미발견 · 직선 상승 생략 · 운반 경로로 진행");
      this.afterLift(job);return;
    }
    if(r.snapTime<ROBOT_PICKING.suctionSnap.seconds&&job.box.parent===ik.grip){
      r.snapTime=Math.min(ROBOT_PICKING.suctionSnap.seconds,r.snapTime+dt);
      job.box.position.lerpVectors(r.snapStart,r.snapEnd,minimumJerk(r.snapTime/ROBOT_PICKING.suctionSnap.seconds));
    }
    // Box held but its destination cannot take it: wait at HOME holding it, then carry on to place.
    if(job.canPlace&&job.box.parent===ik.grip&&["SHOULDER_TRANSFER","ALIGN_BASE","TRANSIT"].includes(r.phase)){
      if(!job.canPlace()){
        if(!this.heldAtHome){this.heldAtHome=true;robotChainStats.homeHolding++;this.options.onProgress?.(r.index,"적재 불가 · 박스 들고 HOME 대기");}
        const base=ik.baseControl;
        this.homePose??={baseYaw:Number.isFinite(base.min)||Number.isFinite(base.max)?this.initialAngles[0]:homeHeading(base.angle,this.initialAngles[0]),angles:this.initialAngles.slice(1),error:0,reachable:true};
        ik.setMinimumToolHeight(null);
        ik.animateEased(this.homePose,dt);
        return;
      }
      if(this.heldAtHome){
        // Placement possible again: replan the carry from HOME.
        this.heldAtHome=false;this.carryOrder=null;this.homePose=null;r.pose=null;r.planning=null;r.alignment=null;r.transit=null;r.preparedShoulder=null;
        this.enter("ALIGN_BASE",job);return;
      }
    }
    if(r.phase==="RELEASE"){this.release(job,dt);return;}
    if(r.phase==="RESTORE_SHOULDER"){this.restoreShoulder(job,dt);return;}
    if(r.transferPlanning&&["LIFT","SHOULDER_TRANSFER"].includes(r.phase)){
      const budget=this.takePlanningSteps("transfer",dt);
      const ikStart=profileStart();
      const prepared=budget>0?ik.advancePlanSteps(r.transferPlanning,budget):null;
      profileEnd("ik",ikStart);
      if(prepared){r.preparedShoulder=prepared;r.transferPlanning=null;}
    }
    if(r.phase==="SHOULDER_TRANSFER"&&r.transferPlanning)return;
    if(r.phase==="ATTACH"){
      const contact=this.graspPoint(job,this.contact),tracked=job.moving&&!r.recovery?this.trackPick(contact,dt):null;
      const reachedContact=tracked!==null?tracked:this.moveTo(contact,job,dt,true);
      if(reachedContact&&isWristAboveBox(ik.controls[2].node,job.box))r.elapsed+=dt;
      else r.elapsed=0;
      if(r.elapsed>=ROBOT_PICKING.graspHoldSeconds)this.attach(job);
      return;
    }
    if(r.boxTurn){
      r.boxTurnElapsed=Math.min(r.boxTurnDuration,r.boxTurnElapsed+dt);
      r.rotation.copy(r.boxTurnFrom).slerp(r.boxTurnTo,minimumJerk(r.boxTurnElapsed/r.boxTurnDuration));
      setCargoWorldPose(job.box,ik.grip,r.releasePosition,r.rotation);
      if(r.boxTurnElapsed>=r.boxTurnDuration)this.enter("TRANSIT",job);
      return;
    }
    if(r.phase==="PRE_PLACE"){
      r.elapsed=Math.min(r.duration+MOTION.contactHold,r.elapsed+dt);
      const progress=minimumJerk(Math.min(1,r.elapsed/r.duration));
      r.rotation.copy(r.releaseRotation).slerp(r.destinationRotation,progress);
      // No tool-roll joint: the held box turns about the suction point; the cargo pose stays authoritative.
      setCargoWorldPose(job.box,ik.grip,r.releasePosition,r.rotation);
      if(r.elapsed>=r.duration+MOTION.contactHold)this.enter("PLACE",job);
      return;
    }
    let reached: boolean;
    if(LINEAR_PHASES.includes(r.phase))reached=this.moveVertical(job,dt);
    else {
      this.graspPoint(job,r.command);
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
    if(r.phase==="LIFT"){this.afterLift(job);return;}
    if(r.phase==="ALIGN_BASE"&&this.startBoxTurn(job))return;
    const next: Partial<Record<RobotPhase,RobotPhase>>={
      PRE_GRASP:"GRASP",GRASP:"ATTACH",
      SHOULDER_TRANSFER:"ALIGN_BASE",ALIGN_BASE:"TRANSIT",TRANSIT:"PRE_PLACE",PLACE:"RELEASE",
    };
    if(r.phase==="RETREAT"){
      r.index++;r.phase="HOME";r.pose=null;r.planning=null;this.idle="chain";this.heldAtHome=false;this.carryOrder=null;
      this.options.onProgress?.(r.index,"RETREAT 완료 · 다음 박스 준비");
    }else {
      const phase=next[r.phase];if(phase)this.enter(phase,job);
    }
  }
}
