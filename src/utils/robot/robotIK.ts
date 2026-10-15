import { IK_CONFIG, MOTION, COLLISION, NUMERICAL_IK } from "../../constants/simulation";
import { Box3, Group, MathUtils, Mesh, Quaternion, Vector3, type Object3D } from "three";
import { createCollisionWorld } from "./collisions";
import { createJointControl, setJointAngle } from "./joints";
import { createKinematics, solvePosition, type NumericResult } from "./robotKinematics";

type IKStep = { angles: number[]; baseYaw: number };
export type IKPose = IKStep & { error: number; reachable: boolean; reason?: "timeout"; blockedBy?: string; route?: IKStep[]; step?: number };

export function createRobotIK(model: Group, motionScale = 1) {
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
  const collisions = createCollisionWorld(model, grip);
  const armMeshes: Mesh[] = [];
  model.traverse(node => {
    if (!(node instanceof Mesh)) return;
    let part: Object3D = node;
    while (part.parent && !/^hand0[1-5]$/.test(part.name)) part = part.parent;
    if (/^hand0[2-5]$/.test(part.name)) { node.geometry.computeBoundingBox(); armMeshes.push(node); }
  });
  const bounds = new Box3();
  const read = () => all.map(control => control.angle);
  const pack = (values: number[]): IKStep => ({ baseYaw: values[0], angles: values.slice(1) });
  const unpack = (pose: IKStep) => [pose.baseYaw, ...pose.angles];
  function apply(values: number[]) {
    all.forEach((control, i) => setJointAngle(control, values[i]));
    model.updateWorldMatrix(true, true);
    collisions.syncHeld();
  }
  function violation(values: number[], planning = false) {
    if (values.some((value, i) => !Number.isFinite(value) || value < all[i].min - 1e-9 || value > all[i].max + 1e-9)) return "관절 각도 제한 초과";
    const collision = collisions.collision(planning ? NUMERICAL_IK.planningArmClearance : 0);
    if (collision) return collision;
    for (const mesh of armMeshes) if (bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).min.y < COLLISION.floorClearance) return "관절이 바닥 여유를 침범";
    return null;
  }
  // Every sampled pose is restored before yielding; planning is invisible.
  function* edge(from: number[], to: number[]): Generator<void, string | null, void> {
    const saved = read();
    const duration = Math.max(...to.map((value, i) => Math.abs(value - from[i]) / (i === 0 ? MOTION.baseAngularSpeed : MOTION.angularSpeed)));
    const samples = Math.max(1, Math.ceil(duration * IK_CONFIG.pathSamplesPerSecond), ...to.map((value, i) => Math.ceil(Math.abs(value - from[i]) / NUMERICAL_IK.planningAngularSample)));
    try {
      for (let sample = 0; sample <= samples; sample++) {
        const values = from.map((value, i) => MathUtils.lerp(value, to[i], sample / samples));
        apply(values);
        const hit = violation(values,true);
        if (hit) return hit;
        if (sample % IK_CONFIG.collisionSamplesPerSlice === 0) { apply(saved); yield; }
      }
      return null;
    } finally { apply(saved); }
  }
  function limitsAround(start: number[]): [number, number][] {
    return all.map((control, i) => control.locked ? [control.angle, control.angle] : [
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
        NUMERICAL_IK.positionTolerance, MathUtils.degToRad(IK_CONFIG.placementWorldTiltToleranceDegrees), i===count?releaseRange:undefined);
      if(!result.converged && i<count) result=yield* solvePosition(forward,before,limits,origin.clone().lerp(target,i/count),false,NUMERICAL_IK.positionTolerance,0);
      if (!result.converged) return {route:null,blockedBy:"직선 경로의 자세 해 미발견 · 오차 "+(result.error*1000).toFixed(1)+"mm"};
      const hit=yield* edge(before,result.angles);
      if(hit)return {route:null,blockedBy:hit};
      before = result.angles; route.push(pack(before));
    }
    return {route,blockedBy:undefined};
  }
  function* jointRoute(start: number[], destination: number[], limits: [number,number][]) {
    // Deterministic RRT with goal bias; only verified edges enter the tree.
    const nodes = [{values:start,parent:-1}];
    let state = 479001599;
    const random = () => { state=(Math.imul(state,1664525)+1013904223)>>>0; return state/4294967296; };
    const distance = (a:number[],b:number[]) => a.reduce((sum,value,i)=>sum+(value-b[i])**2,0);
    for (let iteration=0;iteration<NUMERICAL_IK.routeIterations;iteration++) {
      const sample = iteration%4===0 ? destination : limits.map(([min,max])=>MathUtils.lerp(min,max,random()));
      let index=0;
      for(let i=1;i<nodes.length;i++)if(distance(nodes[i].values,sample)<distance(nodes[index].values,sample))index=i;
      const before=nodes[index].values;
      const ratio=Math.min(1,NUMERICAL_IK.routeStep/Math.sqrt(distance(before,sample)));
      const next=before.map((value,i)=>MathUtils.lerp(value,sample[i],ratio));
      if(yield* edge(before,next))continue;
      nodes.push({values:next,parent:index});
      if(yield* edge(next,destination))continue;
      const route=[pack(destination)];
      for(let i=nodes.length-1;i>0;i=nodes[i].parent)route.unshift(pack(nodes[i].values));
      return route;
    }
    return null;
  }
  function* startPlan(worldTarget: Vector3, wristAbove = false, tracking = false, sliceSolver = false, fastPlacement = false, toolRotation?:Quaternion, constrainPlacementWrist = false, descentTarget?:Vector3): Generator<void, IKPose, void> {
    void sliceSolver; void fastPlacement;
    // Transport solves position only. Downward tilt is imposed for contact and placement,
    // never an arbitrary yaw/roll quaternion that a five-axis arm cannot always satisfy.
    const downward = wristAbove || constrainPlacementWrist;
    const start=read(), limits=limitsAround(start), {forward}=createKinematics(all,grip,wrist);
    const tiltTolerance=MathUtils.degToRad(IK_CONFIG.placementWorldTiltToleranceDegrees);
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
    const position=yield* solvePosition(forward,start,limits,worldTarget,false,NUMERICAL_IK.positionTolerance,tiltTolerance);
    if (!downward && position.converged) seeds.unshift(position.angles);
    for (const seed of seeds) {
      const result=yield* solvePosition(forward,seed,limits,worldTarget,downward,NUMERICAL_IK.positionTolerance,tiltTolerance,releaseRange);
      if(result.error<best.error)best=result;
      if(!result.converged)continue;
      if(candidates.some(c=>c.angles.every((v,i)=>Math.abs(v-result.angles[i])<.05)))continue;
      const endpoint=yield* edge(result.angles,result.angles);
      if(endpoint){firstHit??=endpoint;continue;}
      if(descentTarget){const checked=yield* cartesianRoute(result.angles,descentTarget,false,forward,limits,IK_CONFIG.releaseWorldXDegrees.map(MathUtils.degToRad) as [number,number]);
        if(!checked.route){firstHit??="하강 경로 · "+checked.blockedBy;continue;}}

      candidates.push(result);
      const hit=yield* edge(start,result.angles);
      if(!hit)return {...pack(result.angles),error:result.error,reachable:true};
      firstHit??=hit;
      // A continuous joint's shortest turn can cross the pallet/body. Check
      // the equivalent long turn explicitly instead of hoping RRT finds it.
      for (const indices of [[0],[2],[3],[4],[0,2],[0,3],[0,4],[2,3],[2,4],[3,4]]) {
        const reverse=[...result.angles];
        for(const i of indices)if(!Number.isFinite(all[i].min)&&!all[i].locked)
          reverse[i]-=Math.sign(reverse[i]-start[i]||1)*Math.PI*2;
        if(!(yield* edge(start,reverse)))return {...pack(reverse),error:result.error,reachable:true};
      }
      if(candidates.length>=NUMERICAL_IK.endpointCandidates)break;
      yield;
      // Tracking stays near its current solution, but never skips the full retry on failure.
      if(tracking&&candidates.length>=3)break;
    }
    if(candidates.length){
      const straight=yield* cartesianRoute(start,worldTarget,downward,forward,limits);
      if(straight.route){const end=straight.route.at(-1)!;return {...end,error:forward(unpack(end)).position.distanceTo(worldTarget),reachable:true,route:straight.route,step:0};}
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
  function animate(pose:IKPose,dt:number){
    if(!pose.reachable)return false;
    const target=unpack(pose.route?.[pose.step??0]??pose),saved=read();
    const duration=Math.max(...target.map((value,i)=>Math.abs(value-saved[i])/(i===0?MOTION.baseAngularSpeed:MOTION.angularSpeed)));
    const progress=duration>0?Math.min(1,dt/duration):1;
    const next=saved.map((value,i)=>MathUtils.lerp(value,target[i],progress));
    const samples=Math.max(1,...next.map((value,i)=>Math.ceil(Math.abs(value-saved[i])/IK_CONFIG.angularSample)));
    for(let sample=1;sample<=samples;sample++){
      const values=saved.map((value,i)=>MathUtils.lerp(value,next[i],sample/samples));apply(values);
      if(violation(values)){apply(saved);return false;}
    }
    if(progress===1&&pose.route&&(pose.step??0)<pose.route.length-1)pose.step=(pose.step??0)+1;
    return true;
  }
  function isSettled(pose:IKPose){return (!pose.route||(pose.step??0)===pose.route.length-1)&&controls.every((c,i)=>Math.abs(c.angle-pose.angles[i])<IK_CONFIG.settledAngle)&&Math.abs(baseControl.angle-pose.baseYaw)<IK_CONFIG.settledBaseAngle;}
  // Minimal FK adapter retained for callers that inspect the original chain.
  const effector={updateMatrixWorld:()=>model.updateWorldMatrix(true,true),getWorldPosition:(out:number[])=>grip.getWorldPosition(new Vector3()).toArray(out)};
  return {plan,startPlan,advancePlan,animate,isSettled,collisions,carryRotation,grip,controls,baseControl,effector};
}
