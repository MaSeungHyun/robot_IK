import { IK_CONFIG, MOTION, COLLISION, NUMERICAL_IK } from "../../constants/simulation";
import { Box3, Group, MathUtils, Mesh, Quaternion, Vector3, type Object3D } from "three";
import { createCollisionWorld } from "./collisions";
import { createJointControl, setJointAngle } from "./joints";
import { createKinematics, solvePosition, type NumericResult } from "./robotKinematics";
import { createHeldBoxCollision } from "./heldBoxCollision";
import { minimumJerk } from "./motionTiming";

type IKStep = { angles: number[]; baseYaw: number };
export type IKPose = IKStep & { error: number; reachable: boolean; reason?: "timeout"; blockedBy?: string; route?: IKStep[]; step?: number; target?: Vector3; alignment?: IKPose; transit?: IKPose };
type IKConstraints = { baseYaw?: number; wristAbovePoint?: boolean; descentTarget?: Vector3; wristRange?: [number,number] };

export function createRobotIK(model: Group, motionScale = 1, collisionMode: "world" | "held-box-hand03" = "world") {
  if (motionScale <= 0) throw new Error("Robot geometry scale must be positive");
  const grip = model.getObjectByName("GripPoint")!;
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
  const shaft = grip.getWorldPosition(new Vector3()).sub(wrist.getWorldPosition(new Vector3())).normalize();
  const downRotation = new Quaternion().setFromUnitVectors(shaft, new Vector3(0, -1, 0));
  const upright = downRotation.multiply(grip.getWorldQuaternion(new Quaternion()));
  const carryRotation = upright.clone().invert();
  const heldBoxOnly = collisionMode === "held-box-hand03";
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
  let minimumToolHeight: number | null = null;
  let lastMotionBlock: string | null = null;
  let blockedWristDirection = 0;
  let blockedBaseDirection = 0;
  const read = () => all.map(control => control.angle);
  const pack = (values: number[]): IKStep => ({ baseYaw: values[0], angles: values.slice(1) });
  const unpack = (pose: IKStep) => [pose.baseYaw, ...pose.angles];
  const tiltTolerance = () => MathUtils.degToRad(heldBoxOnly && controls[3].locked
    ? IK_CONFIG.lockedRollTiltToleranceDegrees : IK_CONFIG.placementWorldTiltToleranceDegrees);
  function apply(values: number[]) {
    all.forEach((control, i) => setJointAngle(control, values[i]));
    model.updateWorldMatrix(true, true);
    collisions.syncHeld();
  }
  function violation(values: number[], planning = false) {
    if (values.some((value, i) => !Number.isFinite(value) || value < all[i].min - 1e-9 || value > all[i].max + 1e-9)) return "관절 각도 제한 초과";
    if (minimumToolHeight!==null && grip.getWorldPosition(toolPoint).y<minimumToolHeight-MOTION.contactTolerance) return "이송 경유 높이 미만";
    if (payloadCollision && !payloadCollision.isWristAboveHeld()) return "들어 올리는 동안 hand04가 박스 위에 있어야 합니다.";
    const collision = heldBoxOnly ? collisions.collision() : collisions.collision(planning ? NUMERICAL_IK.planningArmClearance : 0);
    if (collision) return collision;
    if (!heldBoxOnly) for (const mesh of armMeshes) if (bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).min.y < COLLISION.floorClearance) return "관절이 바닥 여유를 침범";
    return null;
  }
  // Every sampled pose is restored before yielding; planning is invisible.
  function* edge(from: number[], to: number[], limits?: [number,number][]): Generator<void, string | null, void> {
    const saved = read();
    const duration = Math.max(...to.map((value, i) => Math.abs(value - from[i]) / (i === 0 ? MOTION.baseAngularSpeed : MOTION.angularSpeed)));
    const samples = Math.max(1, Math.ceil(duration * IK_CONFIG.pathSamplesPerSecond), ...to.map((value, i) => Math.ceil(Math.abs(value - from[i]) / NUMERICAL_IK.planningAngularSample)));
    try {
      for (let sample = 0; sample <= samples; sample++) {
        const values = from.map((value, i) => MathUtils.lerp(value, to[i], sample / samples));
        apply(values);
        if (limits && values.some((value,i) => (limits[i][0]===limits[i][1] || Number.isFinite(all[i].min))
          && (value < limits[i][0]-1e-8 || value > limits[i][1]+1e-8))) return "단계별 관절 고정 범위 초과";
        const hit = violation(values,true);
        if (hit) return hit;
        if (sample % IK_CONFIG.collisionSamplesPerSlice === 0) { apply(saved); yield; }
      }
      return null;
    } finally { apply(saved); }
  }
  function limitsAround(start: number[], constraints?: IKConstraints): [number, number][] {
    return all.map((control, i) => i === 3 && constraints?.wristRange ? constraints.wristRange : i === 0 && constraints?.baseYaw !== undefined ? [constraints.baseYaw,constraints.baseYaw] : control.locked ? [control.angle, control.angle] : [
      Number.isFinite(control.min) ? control.min : start[i] - Math.PI,
      Number.isFinite(control.max) ? control.max : start[i] + Math.PI,
    ]);
  }
  const nearest = (value: number, reference: number) => reference + Math.atan2(Math.sin(value-reference), Math.cos(value-reference));
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
      let result = yield* solvePosition(forward, before, limits, origin.clone().lerp(target,i/count), downward,
        NUMERICAL_IK.positionTolerance, tiltTolerance(), i===count?releaseRange:undefined);
      if(!result.converged && i<count) result=yield* solvePosition(forward,before,limits,origin.clone().lerp(target,i/count),false,NUMERICAL_IK.positionTolerance,0);
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
      const route=[pack(destination)];
      for(let i=nodes.length-1;i>0;i=nodes[i].parent)route.unshift(pack(nodes[i].values));
      return route;
    }
    return null;
  }
  function* startPlan(worldTarget: Vector3, wristAbove = false, tracking = false, sliceSolver = false, fastPlacement = false, toolRotation?:Quaternion, constrainPlacementWrist = false, descentTarget?:Vector3, constraints?:IKConstraints): Generator<void, IKPose, void> {
    void sliceSolver; void fastPlacement;
    // Transport solves position only. Downward tilt is imposed for contact and placement,
    // never an arbitrary yaw/roll quaternion that a five-axis arm cannot always satisfy.
    const downward = wristAbove || constrainPlacementWrist || Boolean(payloadCollision?.holding);
    const start=read(), limits=limitsAround(start,constraints), {forward}=createKinematics(all,grip,wrist);
    const allowedTilt=tiltTolerance();
    const releaseRange=constrainPlacementWrist?IK_CONFIG.releaseWorldXDegrees.map(MathUtils.degToRad) as [number,number]:undefined;
    // Explicit lowering/retreat requests follow Cartesian waypoints first.
    if(toolRotation){
      const checked=yield* cartesianRoute(start,worldTarget,downward,forward,limits,releaseRange);
      if(checked.route){const route=checked.route,end=route.at(-1)!;return {...end,error:forward(unpack(end)).position.distanceTo(worldTarget),reachable:true,route,step:0};}
      return {...pack(start),error:forward(start).position.distanceTo(worldTarget),reachable:false,blockedBy:"수직 하강·후퇴 경로 미발견 · "+checked.blockedBy};
    }
    const seeds=makeSeeds(start,worldTarget,forward);
    let best:NumericResult={angles:start,error:Infinity,tilt:Infinity,converged:false};
    let firstHit:string|null=null;
    const candidates:NumericResult[]=[];
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

      candidates.push(result);
      const hit=yield* edge(start,result.angles,limits);
      if(!hit)return {...pack(result.angles),error:result.error,reachable:true};
      firstHit??=hit;
      // A continuous joint's shortest turn can cross the pallet/body. Check
      // the equivalent long turn explicitly instead of hoping RRT finds it.
      const oppositeTurns = heldBoxOnly ? [[3],[4],[3,4],[0],[2],[0,2],[0,3],[0,4],[2,3],[2,4]] : [[0],[2],[3],[4],[0,2],[0,3],[0,4],[2,3],[2,4],[3,4]];
      for (const indices of oppositeTurns) {
        const reverse=[...result.angles];
        for(const i of indices)if(!Number.isFinite(all[i].min)&&!all[i].locked)
          reverse[i]-=Math.sign(reverse[i]-start[i]||1)*Math.PI*2;
        if(!(yield* edge(start,reverse,limits)))return {...pack(reverse),error:result.error,reachable:true};
      }
      if(candidates.length>=NUMERICAL_IK.endpointCandidates)break;
      yield;
      // Tracking stays near its current solution, but never skips the full retry on failure.
      if(tracking&&candidates.length>=3)break;
    }
    if(candidates.length){
      const straight=yield* cartesianRoute(start,worldTarget,downward,forward,limits);
      if(straight.route){
        const end=straight.route.at(-1)!, values=unpack(end), pose=forward(values);
        const wristOK=!constraints?.wristAbovePoint || pose.wristPosition.y>=worldTarget.y+MOTION.contactTolerance;
        const descent=descentTarget?yield* descentRoute(values,descentTarget,downward,forward,limits,releaseRange):null;
        if(wristOK&&(!descent||descent.route))return {...end,error:pose.position.distanceTo(worldTarget),reachable:true,route:straight.route,step:0};
      }
      candidates.sort((a,b)=>a.angles.reduce((sum,v,i)=>sum+(v-start[i])**2,0)-b.angles.reduce((sum,v,i)=>sum+(v-start[i])**2,0));
      for(const candidate of candidates.slice(0,3)){
        const route=yield* jointRoute(start,candidate.angles,limits);
        if(route)return {...pack(candidate.angles),error:candidate.error,reachable:true,route,step:0};
      }
    }
    const reason=firstHit ? (candidates.length ? "경로 충돌 · " : "목표 자세 충돌 · ")+firstHit : position.converged&&downward
      ? "위치는 도달 가능 · 하향 자세와 관절 제한을 동시에 만족하는 해 미발견"
      : "위치 해 탐색 미수렴 · 오차 "+(best.error*1000).toFixed(1)+"mm (도달 불가 확정 아님)";
    return {...pack(start),error:best.error,reachable:false,blockedBy:reason};
  }
  const planningWork=new WeakMap<ReturnType<typeof startPlan>,number>();
  function advancePlan(search:ReturnType<typeof startPlan>,budgetMs=IK_CONFIG.planningBudgetMs,workLimitMs=Infinity){
    const began=performance.now();
    do {const result=search.next();if(result.done){planningWork.delete(search);return result.value;}}while(performance.now()-began<budgetMs);
    const work=(planningWork.get(search)??0)+performance.now()-began;planningWork.set(search,work);
    if(work>=workLimitMs){planningWork.delete(search);return {...pack(read()),error:Infinity,reachable:false,reason:"timeout" as const};}
    return null;
  }
  function plan(target:Vector3,wristAbove=false,tracking=false){const search=startPlan(target,wristAbove,tracking);for(;;){const result=search.next();if(result.done)return result.value;}}
  function stepAngles(saved: number[], next: number[]) {
    lastMotionBlock=null;
    const samples=Math.max(1,...next.map((value,i)=>Math.ceil(Math.abs(value-saved[i])/IK_CONFIG.angularSample)));
    for(let sample=1;sample<=samples;sample++){
      const values=saved.map((value,i)=>MathUtils.lerp(value,next[i],sample/samples));apply(values);
      const hit=violation(values);
      if(hit){lastMotionBlock=hit;blockedWristDirection=Math.sign(next[3]-saved[3]);blockedBaseDirection=Math.sign(next[0]-saved[0]);apply(saved);return false;}
    }
    return true;
  }
  function animate(pose:IKPose,dt:number){
    if(!pose.reachable)return false;
    const target=unpack(pose.route?.[pose.step??0]??pose),saved=read();
    const duration=Math.max(...target.map((value,i)=>Math.abs(value-saved[i])/(i===0?MOTION.baseAngularSpeed:MOTION.angularSpeed)));
    const progress=duration>0?Math.min(1,dt/duration):1;
    const next=saved.map((value,i)=>MathUtils.lerp(value,target[i],progress));
    if(!stepAngles(saved,next))return false;
    if(progress===1&&pose.route&&(pose.step??0)<pose.route.length-1)pose.step=(pose.step??0)+1;
    return true;
  }
  const animations = new WeakMap<IKPose,{from:number[];elapsed:number;duration:number;step:number}>();
  function animateEased(pose: IKPose, delta: number, speedScale = 1) {
    if(!pose.reachable)return false;
    const step=pose.step??0, target=unpack(pose.route?.[step]??pose);
    let animation=animations.get(pose);
    if(!animation||animation.step!==step){
      const from=read();
      const duration=Math.max(...target.map((value,i)=>Math.abs(value-from[i])/(i===0?MOTION.baseAngularSpeed:MOTION.angularSpeed)))*1.875/Math.max(speedScale,0.01);
      animation={from,elapsed:0,duration:Math.max(duration,0.05),step};animations.set(pose,animation);
    }
    const elapsed=Math.min(animation.duration,animation.elapsed+delta);
    const progress=minimumJerk(elapsed/animation.duration);
    if(!stepAngles(read(),animation.from.map((value,i)=>MathUtils.lerp(value,target[i],progress))))return false;
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
    const point=worldTarget?.clone()??(blocked.reachable?createKinematics(all,grip,wrist).forward(goal).position:null);
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
      if(Math.sign(turn)!==sign)values[axis]+=sign*Math.PI*2;
      return values;
    });
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
    const values = [...start];
    values[0] = nearest(start[0]+turns[0],start[0]);
    const hit = yield* edge(start,values);
    const point = createKinematics(all,grip,wrist).forward(values).position;
    return {...pack(values),error:0,reachable:!hit,blockedBy:hit??undefined,target:point};
  }
  // Nested planning runs from a proposed checkpoint, restoring the real pose at every yield.
  function* fromPose(values: number[], search: () => Generator<void, IKPose, void>): Generator<void, IKPose, void> {
    const actual=read();let virtual=[...values];
    const plan=search();
    try {
      for(;;){
        apply(virtual);const next=plan.next();virtual=read();apply(actual);
        if(next.done)return next.value;
        yield;
      }
    } finally {apply(actual);}
  }
  function* startShoulderTransfer(destination: Vector3, placement: Vector3): Generator<void, IKPose, void> {
    destination=destination.clone();placement=placement.clone();
    const start=read(),{forward}=createKinematics(all,grip,wrist);
    const pivot=baseNode.getWorldPosition(new Vector3()),front=forward(start).position.clone().sub(pivot).setY(0).normalize();
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
    for(let shoulder=controls[0].max;shoulder>start[1]+MathUtils.degToRad(1)&&checked<8;shoulder-=MathUtils.degToRad(4)){
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
    for(let shoulder=controls[0].max;shoulder>start[1]+MathUtils.degToRad(1);shoulder-=MathUtils.degToRad(4)){
      const values=[...start];values[1]=shoulder;values[3]-=shoulder-start[1];
      if(yield* edge(start,values))continue;
      const result=yield* continuation(values);if(result)return result;
    }
    const result=yield* continuation(start);if(result)return result;
    return {...pack(start),error:0,reachable:false,blockedBy:firstHit??"이송까지 연결되는 안전한 경유 자세가 없습니다."};
  }
  // Minimal FK adapter retained for callers that inspect the original chain.
  const effector={updateMatrixWorld:()=>model.updateWorldMatrix(true,true),getWorldPosition:(out:number[])=>grip.getWorldPosition(new Vector3()).toArray(out)};
  return {plan,startPlan,startConstrainedPlan,startCartesianPlan,startBaseAlignment,startShoulderTransfer,advancePlan,animate,animateEased,isSettled,isEasedSettled,startCollisionRecovery,
    get lastMotionBlock(){return lastMotionBlock;},
    setMinimumToolHeight:(height:number|null)=>{minimumToolHeight=height;},collisions,carryRotation,grip,controls,baseControl,effector};
}
