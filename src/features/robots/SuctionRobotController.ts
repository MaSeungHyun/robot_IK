import { Euler, Group, Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import { MOTION, IK_CONFIG } from "../../constants/simulation";
import type { RobotController, RobotControllerOptions } from "../../interface/RobotController";
import type { JointAngleReading } from "../../types/robot";
import { createRobotIK, type IKPose } from "../../utils/robot/robotIK";
import { setJointAngle, blenderWorldX } from "../../utils/robot/joints";

const createRuntime = () => ({
    index: 0,
    stage: 0,
    target: new Vector3(),
    point: new Vector3(),
    parent: null as Group | null,
    waypoints: [] as Vector3[],
    waypoint: 0,
    hold: 0,
    pose: null as IKPose | null,
    planning: null as ReturnType<ReturnType<typeof createRobotIK>["startPlan"]> | null,
    tracking: 0,
    carryRotation: new Quaternion(),
  });
type CargoPose = { parent: Object3D | null; position: Vector3; quaternion: Quaternion; scale: Vector3 };

/** Existing GLB suction arm: collision-aware pickup, transport, release and retreat. */
export class SuctionRobotController implements RobotController {
  readonly id: string;
  readonly model: Group;
  private active = false;
  private disposed = false;
  private readonly ik: ReturnType<typeof createRobotIK>;
  private readonly initialAngles: number[];
  private runtime = createRuntime();
  private manualAngle: { name: string; degrees: number } | null = null;
  private readonly cargo = new Map<Group, CargoPose>();

  private readonly options: RobotControllerOptions;

  constructor(options: RobotControllerOptions) {
    this.options = options;
    this.id = options.id;
    this.model = options.model;
    this.ik = createRobotIK(this.model, options.geometryScale ?? 1);
    this.initialAngles = [this.ik.baseControl, ...this.ik.controls].map(control => control.angle);
  }

  get running() { return this.active; }
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
    this.cargo.clear();
    [this.ik.baseControl, ...this.ik.controls].forEach((control, index) => setJointAngle(control, this.initialAngles[index]));
    this.runtime = createRuntime();
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
    this.cargo.clear();
    this.disposed = true;
  }

  update(delta: number): void {
    if (this.disposed || !Number.isFinite(delta) || delta < 0) return;
    const model = this.model;
    const currentIK = this.ik;
    const allControls = [currentIK.baseControl, ...currentIK.controls];
    if (this.manualAngle) {
      const request = this.manualAngle;
      const control = allControls.find(c => c.node.name === request.name);
      if (control) setJointAngle(control, request.degrees * Math.PI / 180);
      model.updateWorldMatrix(true, true);
      currentIK.collisions.syncHeld();
      this.runtime.pose = null;
      this.runtime.planning = null;
      this.manualAngle = null;
    }

    if (!this.running) return;
    const ik = this.ik, r = this.runtime;
    const job = this.options.getJobs()[r.index];
    if (!job) return;
    const grip = ik.grip, dt = Math.min(delta, MOTION.maxDelta);
    if (r.stage < 2 && job.available && !job.available()) {
      this.cargo.delete(job.box);
      job.onMiss?.(); r.index++; r.stage=0; r.pose=null; r.planning=null;
      this.options.onProgress?.(r.index,"집기 범위를 지난 박스는 통과"); return;
    }
    this.rememberCargo(job.box);
    if (r.stage===0) {
      r.stage=1; r.waypoint=0; r.hold=0; r.tracking=0;
      r.pose=null; r.planning=null;
      this.options.onProgress?.(r.index,"박스 접근 중");
    }
    ik.collisions.setContext({
      boxes:this.options.getObstacles?.()??this.options.getJobs().map(j=>j.box),active:job.box,
      carrying:r.stage===2,grasping:r.stage===1,releasing:r.stage===3,
      carryRotation:r.stage===2?r.carryRotation:undefined,
    });
    if (r.stage===1) {
      r.target.copy(job.pickup);
      if(r.waypoint===0)r.target.y+=MOTION.approachHeight;
      r.tracking+=dt;
      if(job.moving&&r.pose&&r.tracking>=MOTION.trackingInterval){r.pose=null;r.planning=null;r.tracking=0;}
    } else r.target.copy(r.waypoints[r.waypoint]);
    const downward=r.stage===1||r.stage===3;
    if(!r.pose){
      if(!r.planning){
        const predicted=r.target.clone();
        if(job.moving&&r.stage===1&&job.velocity&&grip.getWorldPosition(new Vector3()).distanceTo(r.target)>.05)
          predicted.addScaledVector(job.velocity,MOTION.predictionSeconds);
        job.onPlanEvent?.({state:"searching",reason:"위치 → 하향 기울기 → 충돌 경로 검사",phase:"precise"});
        r.planning=ik.startPlan(predicted,downward,Boolean(job.moving&&r.stage===1),true,false,(r.stage===2&&r.waypoint===2)||r.stage===3?grip.getWorldQuaternion(new Quaternion()):undefined,r.stage===2&&r.waypoint===2,r.stage===2&&r.waypoint===1?job.destination:undefined);
      }
      const pose=ik.advancePlan(r.planning,IK_CONFIG.planningBudgetMs,Infinity);
      if(!pose)return;
      r.planning=null;r.pose=pose;
      if(!pose.reachable){
        job.onPlanEvent?.({state:"rejected",reason:pose.blockedBy??"경로 미발견",phase:"precise"});
        this.options.onProgress?.(r.index,pose.blockedBy??"안전한 경로 미발견");
        return;
      }
      job.onPlanEvent?.({state:"ready",reason:"위치·자세·전체 경로 검사 통과",phase:"precise"});
    }
    if(!r.pose.reachable){
      if(r.stage===1&&job.moving&&r.tracking>=MOTION.retryInterval){r.pose=null;r.tracking=0;}
      return;
    }
    if(!ik.animate(r.pose,dt)){
      r.pose=null;r.planning=null;r.hold=0;
      this.options.onProgress?.(r.index,"움직인 장애물에 맞춰 경로 재검사 · "+(ik.collisions.lastHit??"상태 변화"));return;
    }
    const distance=grip.getWorldPosition(r.point).distanceTo(r.target);
    const arrived=distance<MOTION.contactTolerance&&(r.stage===1&&job.moving||ik.isSettled(r.pose));
    if(!arrived){r.hold=0;return;}
    r.hold+=dt;
    if(r.hold<(r.stage===1&&job.moving?MOTION.movingContactHold:MOTION.contactHold))return;
    r.hold=0;r.pose=null;r.planning=null;r.tracking=0;
    if(r.stage===1){
      if(r.waypoint===0){r.waypoint=1;return;}
      r.parent=job.box.parent as Group;
      grip.attach(job.box);
      // Centre the contact within the millimetre pickup tolerance. The cargo
      // then has no rotating positional offset during the final descent.
      const attachedPosition=job.box.position.clone();
      job.box.position.set(0,0,0);
      ik.collisions.setContext({boxes:this.options.getObstacles?.()??this.options.getJobs().map(j=>j.box),active:job.box,carrying:true});
      if(ik.collisions.collision()){
        job.box.position.copy(attachedPosition);r.parent.attach(job.box);
        r.pose=null;this.options.onProgress?.(r.index,"중앙 파지 자세 재검사");return;
      }
      r.carryRotation.copy(job.box.quaternion).normalize();
      job.box.quaternion.copy(r.carryRotation);
      job.onPick?.();
      const position=grip.getWorldPosition(new Vector3());
      const clearance=Math.max(position.y+MOTION.liftClearance,ik.collisions.liftHeight(job.destination.y));
      const offset=job.box.getWorldPosition(new Vector3()).sub(position);
      const destination=job.destination.clone().sub(offset);
      r.waypoints=[position.clone().setY(clearance),destination.clone().setY(Math.max(destination.y+MOTION.destinationHoverClearance,clearance)),destination];
      r.stage=2;r.waypoint=0;
      this.options.onProgress?.(r.index,"그리퍼에 고정 · 상승 후 운반");return;
    }
    if(r.stage===2){
      if(r.waypoint<r.waypoints.length-1){
        r.waypoint++;
        if(r.waypoint===2){
          // The pickup offset rotates with the tool. Measure it at the upper
          // pose instead of reusing an unrelated initial quaternion.
          const offset=job.box.getWorldPosition(new Vector3()).sub(grip.getWorldPosition(new Vector3()));
          r.waypoints[2]=job.destination.clone().sub(offset);
          this.options.onProgress?.(r.index,"놓기 허용 자세로 수직 하강");
        }
        return;
      }
      // Check the exact release pose, then detach. Never teleport through a box.
      const releaseAngle=blenderWorldX(ik.controls[2].node.getWorldQuaternion(new Quaternion()))*180/Math.PI;
      if(releaseAngle<IK_CONFIG.releaseWorldXDegrees[0]-1e-4||releaseAngle>IK_CONFIG.releaseWorldXDegrees[1]+1e-4){
        const reason="놓기 자세 범위 초과 · hand4 월드 X "+releaseAngle.toFixed(1)+"°";
        r.pose={angles:ik.controls.map(c=>c.angle),baseYaw:ik.baseControl.angle,error:distance,reachable:false,blockedBy:reason};
        this.options.onProgress?.(r.index,reason);return;
      }
      if(!ik.collisions.placementClear(job.destination,job.yaw??0,job.destination.y,new Quaternion())){
        const reason="최종 적재 공간 간섭";
        r.pose={angles:ik.controls.map(c=>c.angle),baseYaw:ik.baseControl.angle,error:distance,reachable:false,blockedBy:reason};
        this.options.onProgress?.(r.index,reason);return;
      }
      // Finish the display alignment only after releasing the rigid attachment.
      r.parent!.attach(job.box);
      job.box.position.copy(r.parent!.worldToLocal(job.destination.clone()));
      job.box.quaternion.setFromAxisAngle(new Vector3(0,1,0),job.yaw??0);
      ik.collisions.setContext({boxes:this.options.getObstacles?.()??this.options.getJobs().map(j=>j.box),active:job.box,carrying:false,releasing:true});
      r.stage=3;r.waypoint=0;
      r.waypoints=[grip.getWorldPosition(new Vector3()).add(new Vector3(0,MOTION.retreatHeight,0))];
      this.options.onProgress?.(r.index,"적재 후 수직으로 손 빼는 중");return;
    }
    job.onPlace?.();this.cargo.delete(job.box);r.index++;r.stage=0;
    this.options.onProgress?.(r.index,"적재 완료 · 다음 박스 준비 중");
  }
}
