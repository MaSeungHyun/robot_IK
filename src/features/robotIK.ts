import { IK_CONFIG, MOTION, COLLISION } from "./constants";
import { Goal, Joint, Link, Solver } from "closed-chain-ik/core";
import * as IKCore from "closed-chain-ik/core";
import { Box3, Group, MathUtils, Mesh, Quaternion, Vector3, type Object3D } from "three";
import { createCollisionWorld } from "./collisions";
import { createJointControl, setJointAngle } from "./joints";
// Upstream declares a const enum although it exports a runtime object.
// Read the actual object without relying on const-enum inlining.
const DOF = (IKCore as unknown as { DOF: { X: 0; Y: 1; Z: 2; EX: 3; EY: 4; EZ: 5 } }).DOF;
const SOLVE_STATUS = (IKCore as unknown as { SOLVE_STATUS: { TIMEOUT: 3 } }).SOLVE_STATUS;

type IKStep = { angles: number[]; rail: number };
export type IKPose = IKStep & { error: number; reachable: boolean; reason?: "timeout"; blockedBy?:string; route?: IKStep[]; step?: number };

export function createRobotIK(model: Group, motionScale=1) {
  const railSpeed=MOTION.railSpeed*motionScale;
  const gripNode = model.getObjectByName("GripPoint");
  if (!gripNode) throw new Error("Robot model is missing GripPoint");
  const grip = gripNode;
  const wristNode = model.getObjectByName("hand04")!;
  model.updateWorldMatrix(true, true);
  const gripPosition = grip.getWorldPosition(new Vector3());
  const wristVector = wristNode.getWorldPosition(new Vector3()).sub(gripPosition);
  // The planar arm rotates about world Z. Align its wrist-to-contact vector
  // vertically so the wrist is above the contact point, never beside cargo.
  const downwardRotation = new Quaternion().setFromAxisAngle(new Vector3(0,0,1), Math.atan2(wristVector.x, wristVector.y));
  const uprightGripQuaternion = downwardRotation.multiply(grip.getWorldQuaternion(new Quaternion()));
  // Keep shoulder/elbow/wrist indices stable; roll is the fourth control.
  const controls = [1, 2, 4, 3].map(i => {
    const node = model.getObjectByName(`hand0${i}`);
    if (!node) throw new Error(`Robot model is missing hand0${i}`);
    return createJointControl(node);
  });
  const collisions = createCollisionWorld(model, grip);
  const origin = model.position.clone();
  const root = new Link();
  const rail = new Joint();
  rail.name = "base-rail";
  rail.setDoF(DOF.Z);
  const base = new Link();
  root.addChild(rail);
  rail.addChild(base);

  const path = [];
  for (let node = grip; node; node = node.parent!) {
    path.unshift(node);
    if (node === model) break;
  }
  let parent = base;
  const hinges: Joint[] = [];
  for (const node of path) {
    if (node.scale.distanceTo(new Vector3(1,1,1)) > 1e-5) {
      throw new Error(`IK chain requires applied scale on ${node.name || "scene"}`);
    }
    const joint = new Joint();
    joint.name = node.name;
    joint.setPosition(node.position.x, node.position.y, node.position.z);
    joint.setQuaternion(node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w);
    const control = controls.find(c => c.node === node);
    if (control) {
      joint.setDoF(DOF[control.dof]);
      joint.setMinLimits(control.min - control.initialX);
      joint.setMaxLimits(control.max - control.initialX);
      hinges[controls.indexOf(control)] = joint;
    } else {
      joint.setDoF(); // Preserve the remaining fixed model transforms.
    }
    const link = new Link();
    parent.addChild(joint);
    joint.addChild(link);
    parent = link;
  }
  const effector = parent;
  const goal = new Goal();
  goal.setGoalDoF(DOF.X, DOF.Y, DOF.Z, DOF.EX, DOF.EY, DOF.EZ);
  goal.makeClosure(effector);
  const solver = new Solver(root);
  solver.useSVD = true;
  solver.maxIterations = IK_CONFIG.iterations;
  solver.dampingFactor = IK_CONFIG.damping;
  solver.translationConvergeThreshold = IK_CONFIG.translationConvergence;
  solver.stallThreshold = IK_CONFIG.stallTolerance;
  solver.restPoseFactor = IK_CONFIG.restPoseFactor;
  // Select the equivalent negative-angle representation before motion.
  for(const control of controls){
    let angle=control.angle;
    if(control.node.name==="hand04")angle+=2*Math.PI*Math.ceil((control.min-angle)/(2*Math.PI));
    setJointAngle(control,angle);
  }
  const localTarget = new Vector3();
  const solvedPosition: number[] = [0,0,0];
  const armMeshes: Mesh[] = [];
  model.traverse(node => {
    if (!(node instanceof Mesh)) return;
    let part: Object3D = node;
    while (part.parent && !/^hand0[1-5]$/.test(part.name)) part = part.parent;
    if (/^hand0[2-5]$/.test(part.name)) {
      node.geometry.computeBoundingBox();
      armMeshes.push(node);
    }
  });
  const bounds = new Box3();
  const samplePoint = new Vector3();
  let lockedToolRotation:Quaternion|undefined;

  function* checkPathSteps(angles: number[], destinationRail: number, target: Vector3, wristAbove: boolean, from?: IKStep, minimumY?: number) {
    if(angles.some((angle,i)=>angle<controls[i].min||angle>controls[i].max))return {safe:false,minimumHeight:0,blockedBy:"관절 각도 제한 초과",hand3Collision:false};
    const originalAngles = controls.map(c => c.angle);
    const originalPosition = model.position.clone();
    const savedAngles = from?.angles ?? originalAngles;
    const savedPosition = originalPosition.clone();
    if (from) savedPosition.z = origin.z + from.rail;
    controls.forEach((c,i) => setJointAngle(c,savedAngles[i]));
    model.position.copy(savedPosition);
    model.updateWorldMatrix(true, true);
    const minimumGripY = minimumY ?? Math.min(grip.getWorldPosition(samplePoint).y, target.y) - MOTION.contactTolerance;
    const duration = Math.max(
      ...angles.map((a, i) => Math.abs(a - savedAngles[i]) / MOTION.angularSpeed),
      Math.abs(origin.z + destinationRail - savedPosition.z) / railSpeed,
    );
    let safe = true;
    let blockedBy:string|undefined;
    let hand3Collision=false;
    let minimumHeight = Infinity;
    // Sample the same speed-limited trajectory used by animate(), not a
    // straight line between end-effector positions or just the endpoint.
    const samples = Math.max(1, Math.ceil(duration * IK_CONFIG.pathSamplesPerSecond),
      ...angles.map((a,i)=>Math.ceil(Math.abs(a-savedAngles[i])/IK_CONFIG.angularSample)),
      Math.ceil(Math.abs(origin.z+destinationRail-savedPosition.z)/IK_CONFIG.railSample));
    for (let sample = 0; sample <= samples && safe; sample++) {
      const progress = sample / samples;
      controls.forEach((control, i) => setJointAngle(control, MathUtils.lerp(savedAngles[i], angles[i], progress)));
      model.position.z = MathUtils.lerp(savedPosition.z, origin.z + destinationRail, progress);
      model.updateWorldMatrix(true, true);
      const height = grip.getWorldPosition(samplePoint).y;
      minimumHeight = Math.min(minimumHeight, height);
      if(height<minimumGripY){safe=false;blockedBy??="그립 경로가 높이 여유 아래로 내려감";}
      const collision=collisions.collision();if(collision){safe=false;blockedBy??=collision;hand3Collision ||= collision.includes("운반 박스와 hand03");}
      for (const mesh of armMeshes) {
        if (bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).min.y < COLLISION.floorClearance){safe=false;blockedBy??="관절이 바닥 여유를 침범";}
      }
      if (sample===samples && lockedToolRotation && grip.getWorldQuaternion(new Quaternion()).angleTo(lockedToolRotation)>IK_CONFIG.orientationTolerance){safe=false;blockedBy??="하강 중 손목 방향 유지 실패";}
      if (wristAbove && sample === samples) {
        // Turning around vertical preserves the downward contact direction.
        const relative = grip.getWorldQuaternion(new Quaternion()).multiply(uprightGripQuaternion.clone().invert());
        if (IK_CONFIG.requireDownwardOrientation && new Vector3(0,1,0).applyQuaternion(relative).angleTo(new Vector3(0,1,0)) > IK_CONFIG.orientationTolerance){safe=false;blockedBy??="손끝 하향 자세 오차";}
        if (wristNode.getWorldPosition(new Vector3()).y < height + IK_CONFIG.wristPivotClearance){safe=false;blockedBy??="hand4가 박스 위에 위치하지 않음";}
        // Real mesh/cargo collision is checked above. A wrist bounding box
        // below the cargo top does not imply penetration beside the cargo.
      }
      if (safe && sample % IK_CONFIG.collisionSamplesPerSlice === 0) {
        controls.forEach((control,i)=>setJointAngle(control,originalAngles[i]));
        model.position.copy(originalPosition);model.updateWorldMatrix(true,true);collisions.syncHeld();
        yield;
      }
    }
    controls.forEach((control, i) => setJointAngle(control, originalAngles[i]));
    model.position.copy(originalPosition);
    model.updateWorldMatrix(true, true);
    collisions.syncHeld();
    return { safe, minimumHeight, blockedBy, hand3Collision };
  }

  function* findRaisedRoute(destination:IKStep,target:Vector3,wristAbove:boolean){
    if(lockedToolRotation)return null; // Final lowering keeps its upper pose.
    const start:IKStep={angles:controls.map(c=>c.angle),rail:model.position.z-origin.z};
    const startHeight=grip.getWorldPosition(new Vector3()).y;
    const shoulder=MathUtils.degToRad(IK_CONFIG.raisedShoulderDegrees);
    for(const degrees of IK_CONFIG.raisedElbowSeedsDegrees){
      const elbow=start.angles[1]+Math.atan2(Math.sin(MathUtils.degToRad(degrees)-start.angles[1]),Math.cos(MathUtils.degToRad(degrees)-start.angles[1]));
      const wrist=start.angles[2]-(shoulder-start.angles[0])-(elbow-start.angles[1]);
      const raised:IKStep={angles:[shoulder,elbow,wrist,start.angles[3]],rail:start.rail};
      if(wrist<controls[2].min||wrist>controls[2].max)continue;
      controls.forEach((c,i)=>setJointAngle(c,raised.angles[i]));model.updateWorldMatrix(true,true);
      const height=grip.getWorldPosition(new Vector3()).y;
      controls.forEach((c,i)=>setJointAngle(c,start.angles[i]));model.updateWorldMatrix(true,true);collisions.syncHeld();
      if(height<startHeight+IK_CONFIG.raisedMinimumGain)continue;
      yield;
      if(!(yield* checkPathSteps(raised.angles,raised.rail,target,false,start,IK_CONFIG.routeMinimumHeight)).safe)continue;
      const shifted:IKStep={angles:[...raised.angles],rail:destination.rail};
      if(!(yield* checkPathSteps(shifted.angles,shifted.rail,target,false,raised,height-MOTION.contactTolerance)).safe)continue;
      if((yield* checkPathSteps(destination.angles,destination.rail,target,wristAbove,shifted,IK_CONFIG.routeMinimumHeight)).safe)return [raised,shifted,destination];
    }
    return null;
  }

  function* findRoute(destination: IKStep, target: Vector3, wristAbove: boolean) {
    const start: IKStep = { angles: controls.map(c => c.angle), rail: model.position.z - origin.z };
    const minimumY = IK_CONFIG.routeMinimumHeight;
    if (!(yield* checkPathSteps(destination.angles,destination.rail,target,wristAbove,destination,minimumY)).safe) return null;
    const raisedRoute=yield* findRaisedRoute(destination,target,wristAbove);
    if(raisedRoute)return raisedRoute;
    // Try opposite shoulder/elbow bends before randomized exploration.
    // Coordinating hand04 cancels the bend's net orientation change while
    // cargo is attached, so the wrist does not sweep through the box.
    const reverse = destination.angles.map((a,i) => -Math.sign(a-start.angles[i] || 1));
    for (const angle of IK_CONFIG.rollSeedsDegrees.map(MathUtils.degToRad).filter(a=>a!==0)) {
      yield;
      const retreat: IKStep = {angles: [...start.angles], rail: start.rail};
      retreat.angles[3] += angle;
      if (!(yield* checkPathSteps(retreat.angles,retreat.rail,target,false,start,minimumY)).safe) continue;
      if ((yield* checkPathSteps(destination.angles,destination.rail,target,wristAbove,retreat,minimumY)).safe) return [retreat,destination];
    }
    for (const magnitude of [Math.PI/6,Math.PI/3,Math.PI/2]) {
      for (const [a,b] of [[reverse[0],0],[0,reverse[1]],[reverse[0],reverse[1]],[-reverse[0],0],[0,-reverse[1]],[-reverse[0],-reverse[1]]]) {
        yield;
        const shoulder=MathUtils.clamp(start.angles[0]+a*magnitude,controls[0].min,controls[0].max);
        const elbow=MathUtils.clamp(start.angles[1]+b*magnitude,controls[1].min,controls[1].max);
        const retreat: IKStep = { angles:[shoulder,elbow,start.angles[2]-(shoulder-start.angles[0])-(elbow-start.angles[1]),start.angles[3]],rail:start.rail };
        if (!(yield* checkPathSteps(retreat.angles,retreat.rail,target,false,start,minimumY)).safe) continue;
        if ((yield* checkPathSteps(destination.angles,destination.rail,target,wristAbove,retreat,minimumY)).safe) return [retreat,destination];
      }
    }
    const nodes: { state: IKStep; parent: number }[] = [{state:start,parent:-1}];
    let seed = 1234567;
    const random = () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
    const distance = (a:IKStep,b:IKStep) => a.angles.reduce((v,x,i)=>v+(x-b.angles[i])**2,0)+(a.rail-b.rail)**2;
    for(let iteration=0;iteration<IK_CONFIG.routeIterations;iteration++) {
      yield;
      const sample: IKStep = random()<IK_CONFIG.routeGoalBias ? destination : {
        angles: [
          MathUtils.lerp(controls[0].min,controls[0].max,random()),
          MathUtils.lerp(start.angles[1]-Math.PI,start.angles[1]+Math.PI,random()),
          MathUtils.lerp(controls[2].min,controls[2].max,random()),
          start.angles[3]+(random()*2-1)*2*Math.PI,
        ],
        rail: MathUtils.lerp(Math.min(start.rail,destination.rail)-IK_CONFIG.routeRailMargin,Math.max(start.rail,destination.rail)+IK_CONFIG.routeRailMargin,random()),
      };
      // Upright cargo leaves a narrow corridor in joint space. Sample
      // coordinated bends as well as unrestricted states, keeping the wrist
      // orientation between the current and desired downward orientations.
      if (random()<IK_CONFIG.coordinatedWristProbability && sample!==destination) {
        const sum=MathUtils.lerp(start.angles.slice(0,3).reduce((a,b)=>a+b,0),destination.angles.slice(0,3).reduce((a,b)=>a+b,0),random());
        sample.angles[2]=sum-sample.angles[0]-sample.angles[1];
      }
      let nearest=0;
      for(let i=1;i<nodes.length;i++) if(distance(nodes[i].state,sample)<distance(nodes[nearest].state,sample)) nearest=i;
      const before=nodes[nearest].state;
      const fraction=Math.min(1,IK_CONFIG.routeStep/Math.sqrt(distance(before,sample)));
      const next: IKStep = {angles:before.angles.map((a,i)=>MathUtils.lerp(a,sample.angles[i],fraction)),rail:MathUtils.lerp(before.rail,sample.rail,fraction)};
      if(!(yield* checkPathSteps(next.angles,next.rail,target,false,before,minimumY)).safe) continue;
      nodes.push({state:next,parent:nearest});
      if(!(yield* checkPathSteps(destination.angles,destination.rail,target,wristAbove,next,minimumY)).safe) continue;
      const route=[destination];
      for(let i=nodes.length-1;i>0;i=nodes[i].parent) route.unshift(nodes[i].state);
      // Shortcut only when the entire replacement segment passes collision tests.
      const compact:IKStep[]=[]; let current=start, index=0;
      while(index<route.length) {
        yield;
        let end=route.length-1;
        while(end>index && !(yield* checkPathSteps(route[end].angles,route[end].rail,target,end===route.length-1&&wristAbove,current,minimumY)).safe) end--;
        compact.push(route[end]);current=route[end];index=end+1;
      }
      return compact;
    }
    return null;
  }

  function* startPlan(worldTarget: Vector3, wristAbove = false, tracking = false, sliceSolver = false, fastPlacement = false, toolRotation?:Quaternion): Generator<void, IKPose, void> {
    lockedToolRotation=toolRotation?.clone();
    const iterationLimit=tracking?IK_CONFIG.trackingIterations:IK_CONFIG.iterations;
    const solverChunk=sliceSolver?Math.min(iterationLimit,IK_CONFIG.solverIterationsPerSlice):iterationLimit;
    solver.maxIterations=solverChunk;
    model.parent?.updateWorldMatrix(true, false);
    localTarget.copy(worldTarget);
    if (model.parent) model.parent.worldToLocal(localTarget);
    goal.setPosition(localTarget.x, localTarget.y, localTarget.z);
    goal.setGoalDoF(...(wristAbove ? [DOF.X, DOF.Y, DOF.Z, DOF.EX, DOF.EY, DOF.EZ] : [DOF.X, DOF.Y, DOF.Z]));
    const localQuaternion = (toolRotation??uprightGripQuaternion).clone();
    if (model.parent) localQuaternion.premultiply(model.parent.getWorldQuaternion(new Quaternion()).invert());
    goal.setQuaternion(localQuaternion.x, localQuaternion.y, localQuaternion.z, localQuaternion.w);
    const saved = controls.map(c => c.angle - c.initialX);
    const currentRail = model.position.z - origin.z;
    let best: IKPose = { angles: controls.map(c => c.angle), rail: currentRail, error: Infinity, reachable: false };
    let bestCost = Infinity;
    const alternatives: (IKStep & {error:number})[] = [];
    let hand3CargoBlocked=false;
    function* attempt(seed: number[], freezeWrist: boolean, freezeRoll = true) {
      seed=seed.map((value,i)=>{
        if(i===0)return MathUtils.clamp(value,controls[i].min-controls[i].initialX,controls[i].max-controls[i].initialX);
        if(i===2){
          let angle=value+controls[i].initialX;
          angle+=2*Math.PI*Math.ceil((controls[i].min-angle)/(2*Math.PI));
          return MathUtils.clamp(angle,controls[i].min,controls[i].max)-controls[i].initialX;
        }
        return saved[i]+Math.atan2(Math.sin(value-saved[i]),Math.cos(value-saved[i]));
      });
      rail.setDoFValue(DOF.Z, currentRail);
      hinges.forEach((joint, i) => {
        const control = controls[i];
        joint.setMinLimits(i === 2 ? (freezeWrist?seed[i]:control.min-control.initialX) : i === 1 ? saved[i]-Math.PI : (i === 2 || i === 3) ? ((i === 2 ? freezeWrist : freezeRoll) ? (i===2?seed[i]:saved[i]) : saved[i] - 2 * Math.PI) : control.min - control.initialX);
        joint.setMaxLimits(i === 2 ? (freezeWrist?seed[i]:control.max-control.initialX) : i === 1 ? saved[i]+Math.PI : (i === 2 || i === 3) ? ((i === 2 ? freezeWrist : freezeRoll) ? (i===2?seed[i]:saved[i]) : saved[i] + 2 * Math.PI) : control.max - control.initialX);
        joint.setDoFValue(DOF[control.dof], seed[i]);
        joint.setRestPoseValue(DOF[control.dof], saved[i]);
        joint.restPoseSet = true;
      });
      root.updateMatrixWorld();
      for(let iteration=0;iteration<iterationLimit;iteration+=solverChunk){
        const status=solver.solve();
        yield;
        if(!status.includes(SOLVE_STATUS.TIMEOUT))break;
      }
      effector.getWorldPosition(solvedPosition);
      const error = localTarget.distanceTo(new Vector3().fromArray(solvedPosition));
      const offsets = hinges.map((j,i) => Number(j.getDoFValue(DOF[controls[i].dof])));
      const reachable = error < IK_CONFIG.targetTolerance;
      let angles = offsets.map((v, i) => {
        if(i===1||i===3)offsets[i]=saved[i]+Math.atan2(Math.sin(v-saved[i]),Math.cos(v-saved[i]));
        return offsets[i]+controls[i].initialX;
      });
      const railPosition = Number(rail.getDoFValue(DOF.Z));
      let trajectory = reachable ? (yield* checkPathSteps(angles, railPosition, worldTarget, wristAbove)) : { safe: false, minimumHeight: 0, blockedBy:undefined, hand3Collision:false };
      if(reachable&&!trajectory.safe){
        // Same final pose, opposite turn. Check each continuous joint and
        // coordinated combinations; the solver's raw angle is not guaranteed
        // to contain the opposite route, especially after normalization.
        const endpoint=yield* checkPathSteps(angles,railPosition,worldTarget,wristAbove,{angles,rail:railPosition});
        if(endpoint.safe){
          const opposite: number[][]=[];
          for(let mask=1;mask<(1<<(controls.length-1));mask++){
            opposite.push(angles.map((angle,i)=>(i===1||i===3)&&(mask&(1<<(i-1)))
              ? angle-Math.sign(angle-controls[i].angle||1)*2*Math.PI : angle));
          }
          opposite.sort((a,b)=>a.reduce((sum,v,i)=>sum+(v-controls[i].angle)**2,0)-b.reduce((sum,v,i)=>sum+(v-controls[i].angle)**2,0));
          for(const candidate of opposite){
            yield;
            const reverse=yield* checkPathSteps(candidate,railPosition,worldTarget,wristAbove);
            if(reverse.safe){angles=candidate;offsets.splice(0,offsets.length,...angles.map((v,i)=>v-controls[i].initialX));trajectory=reverse;break;}
          }
        }
      }
      if(reachable&&!trajectory.safe&&wristAbove&&!tracking&&!lockedToolRotation){
        const route=yield* findRaisedRoute({angles,rail:railPosition},worldTarget,wristAbove);
        if(route){best={angles,rail:railPosition,error,reachable:true,route,step:0};bestCost=0;return;}
      }
      if (reachable && !trajectory.safe && !alternatives.some(a => a.angles.every((v,i)=>Math.abs(v-angles[i])<IK_CONFIG.alternativeAngleTolerance))) alternatives.push({angles,rail:railPosition,error});
      if(trajectory.hand3Collision)hand3CargoBlocked=true;
      const travel = offsets.reduce((sum, v, i) => sum + (v - saved[i]) ** 2 * (i === 2 ? 4 : 1), 0);
      const cost = reachable && trajectory.safe ? travel : IK_CONFIG.unreachableCost + error;
      if (cost < bestCost) {
        bestCost = cost;
        best = { angles, rail: railPosition, error, reachable: reachable && trajectory.safe,
          blockedBy:reachable?trajectory.blockedBy:`IK 위치 오차 ${error.toFixed(3)}m` };
      }
    }
    // Warm start, then alternate shoulder/elbow seeds if necessary. Every
    // candidate is solved by the library, within its configured limits.
    yield* attempt(saved, true);
    yield;
    const shoulderSeeds = IK_CONFIG.shoulderSeedsDegrees.map(MathUtils.degToRad);
    const elbowSeeds = IK_CONFIG.elbowSeedsDegrees.map(MathUtils.degToRad);
    let triedOppositeWrist=false;
    function* tryOppositeWrist(){
      triedOppositeWrist=true;
      // Change the final hand04 bend itself, rather than adding one turn to
      // the same angle. Keep that bend fixed while hand01/02 solve position.
      goal.setGoalDoF(DOF.X,DOF.Y,DOF.Z);
      const mirrored=-controls[2].angle-controls[2].initialX;
      const bends=[mirrored,...IK_CONFIG.oppositeWristSeedsDegrees.map(degrees=>saved[2]+MathUtils.degToRad(degrees))];
      for(const bend of bends){
        for(const [a,b] of [[controls[0].angle,controls[1].angle],...shoulderSeeds.flatMap(a=>elbowSeeds.map(b=>[a,b]))]){
          yield* attempt([a-controls[0].initialX,b-controls[1].initialX,bend,saved[3]],true);
          yield;if(best.reachable)return best;
        }
      }
      // Resume normal exploration with its original orientation preference.
      goal.setGoalDoF(DOF.X,DOF.Y,DOF.Z,DOF.EX,DOF.EY,DOF.EZ);
    }
    if(hand3CargoBlocked && wristAbove && !toolRotation && !IK_CONFIG.requireDownwardOrientation && !tracking && !best.reachable){
      yield* tryOppositeWrist();if(best.reachable)return best;
    }
    if(motionScale>1&&!tracking&&!best.reachable){
      // Choose starts by forward kinematics, instead of only three fixed
      // elbow bends. Align hand04 around its actual world rotation axis.
      const starts:{seed:number[];score:number}[]=[];
      const qArray=[0,0,0,1],pArray=[0,0,0];
      for(const a of IK_CONFIG.workspaceShoulderSeedsDegrees)for(const b of IK_CONFIG.workspaceElbowSeedsDegrees){
        const seed=[MathUtils.degToRad(a)-controls[0].initialX,MathUtils.degToRad(b)-controls[1].initialX,saved[2],saved[3]];
        rail.setDoFValue(DOF.Z,currentRail);
        hinges.forEach((joint,i)=>{
          joint.setMinLimits(-Infinity);joint.setMaxLimits(Infinity);
          joint.setDoFValue(DOF[controls[i].dof],seed[i]);
        });
        root.updateMatrixWorld();effector.getWorldQuaternion(qArray);
        const delta=localQuaternion.clone().multiply(new Quaternion().fromArray(qArray).invert());
        hinges[2].getWorldQuaternion(qArray);
        const axis=new Vector3(1,0,0).applyQuaternion(new Quaternion().fromArray(qArray));
        seed[2]+=2*Math.atan2(delta.x*axis.x+delta.y*axis.y+delta.z*axis.z,delta.w);
        hinges[2].setDoFValue(DOF.EX,seed[2]);root.updateMatrixWorld();effector.getWorldPosition(pArray);
        starts.push({seed,score:(pArray[0]-localTarget.x)**2+(pArray[1]-localTarget.y)**2});
      }
      for(const start of starts.sort((a,b)=>a.score-b.score).slice(0,IK_CONFIG.workspaceSeedCount)){
        yield* attempt(start.seed,false);yield;if(best.reachable)return best;
      }
    }
    if(tracking||fastPlacement){
      if(!best.reachable)for(let i=0;i<3&&!best.reachable;i++){yield* attempt([shoulderSeeds[i]-controls[0].initialX,elbowSeeds[i]-controls[1].initialX,saved[2],saved[3]],false);yield;}
      return best;
    }
    if (!best.reachable) {
      for (const a of shoulderSeeds) for (const b of elbowSeeds) {
        yield* attempt([a - controls[0].initialX, b - controls[1].initialX, saved[2],saved[3]], true);
        yield;if(best.reachable)return best;
      }
    }
    if (!best.reachable) {
      for (const a of shoulderSeeds) for (const b of elbowSeeds) for (const w of [0, -Math.PI / 2, Math.PI / 2, -Math.PI, Math.PI]) {
        yield* attempt([a - controls[0].initialX, b - controls[1].initialX, saved[2] + w,saved[3]], false);
        yield;if(best.reachable)return best;
      }
    }
    if (!best.reachable) {
      for (const roll of IK_CONFIG.rollSeedsDegrees.map(MathUtils.degToRad)) {
        for (const a of shoulderSeeds) for (const b of elbowSeeds) {
          yield* attempt([a-controls[0].initialX,b-controls[1].initialX,saved[2],saved[3]+roll],false,false);
          yield;if(best.reachable)return best;
        }
      }
    }
    if(hand3CargoBlocked && !triedOppositeWrist && wristAbove && !toolRotation && !IK_CONFIG.requireDownwardOrientation && !tracking && !best.reachable){
      yield* tryOppositeWrist();if(best.reachable)return best;
    }
    // Prefer the stable pickup orientation, but allow tilted wrist solutions.
    if(wristAbove && !toolRotation && !IK_CONFIG.requireDownwardOrientation && !best.reachable){
      goal.setGoalDoF(DOF.X,DOF.Y,DOF.Z);
      for(const a of shoulderSeeds)for(const b of elbowSeeds){
        yield* attempt([a-controls[0].initialX,b-controls[1].initialX,saved[2],saved[3]],false,false);
        yield;if(best.reachable)return best;
      }
    }
    // Retry equivalent downward goals with alternate shoulder/elbow bends.
    if (wristAbove && IK_CONFIG.requireDownwardOrientation && !best.reachable) {
      for (const yaw of IK_CONFIG.downwardYawSeedsDegrees.map(MathUtils.degToRad)) {
        const rotated = new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw).multiply(uprightGripQuaternion);
        if(model.parent)rotated.premultiply(model.parent.getWorldQuaternion(new Quaternion()).invert());
        goal.setQuaternion(rotated.x,rotated.y,rotated.z,rotated.w);
        for(const a of shoulderSeeds)for(const b of elbowSeeds){
          yield* attempt([a-controls[0].initialX,b-controls[1].initialX,saved[2],saved[3]],false,false);
          yield;if(best.reachable)return best;
        }
      }
    }
    if (!best.reachable) {
      for (const candidate of alternatives.sort((a,b)=>a.angles.reduce((sum,v,i)=>sum+(v-controls[i].angle)**2,0)-b.angles.reduce((sum,v,i)=>sum+(v-controls[i].angle)**2,0)).slice(0,IK_CONFIG.routeCandidates)) {
        const route=yield* findRoute(candidate,worldTarget,wristAbove);
        if(route) {best={...candidate,reachable:true,route,step:0};break;}
      }
    }
    return best;
  }

  const planningWork = new WeakMap<ReturnType<typeof startPlan>, number>();
  function advancePlan(search: ReturnType<typeof startPlan>, budgetMs = IK_CONFIG.planningBudgetMs, workLimitMs = Infinity) {
    const start=performance.now();
    do {
      const result=search.next();
      if(result.done){planningWork.delete(search);return result.value;}
    } while(performance.now()-start<budgetMs);
    const work=(planningWork.get(search)??0)+performance.now()-start;
    planningWork.set(search,work);
    if(work>=workLimitMs){
      const failed:IKPose={angles:controls.map(c=>c.angle),rail:model.position.z-origin.z,error:Infinity,reachable:false,reason:"timeout"};
      // A work budget is a scheduling boundary, not evidence of collision.
      // Keep the restored generator alive so the caller can resume it.
      planningWork.delete(search);return failed;
    }
    return null;
  }
  // Synchronous entry point for deterministic offline tests.
  function plan(target: Vector3, wristAbove=false, tracking=false): IKPose {
    const search=startPlan(target,wristAbove,tracking);
    for(;;){const result=search.next();if(result.done)return result.value;}
  }

  function animate(pose: IKPose, dt: number) {
    if (!pose.reachable) return false;
    const target = pose.route?.[pose.step ?? 0] ?? pose;
    const savedAngles = controls.map(c => c.angle);
    const savedPosition = model.position.clone();
    // All motors share the same progress fraction. In this planar chain,
    // matching start/end wrist orientation then preserves it while lowering.
    const remainingDuration = Math.max(
      ...controls.map((control, i) => Math.abs(target.angles[i] - control.angle) / MOTION.angularSpeed),
      Math.abs(origin.z + target.rail - model.position.z) / railSpeed,
    );
    const progress = remainingDuration > 0 ? Math.min(1, dt / remainingDuration) : 1;
    controls.forEach((control, i) => {
      setJointAngle(control, MathUtils.lerp(control.angle, target.angles[i], progress));
    });
    model.position.z = MathUtils.lerp(model.position.z, origin.z + target.rail, progress);
    model.updateWorldMatrix(true, true);
    const nextAngles=controls.map(c=>c.angle), nextPosition=model.position.clone();
    const samples=Math.max(1,...nextAngles.map((a,i)=>Math.ceil(Math.abs(a-savedAngles[i])/IK_CONFIG.angularSample)),Math.ceil(Math.abs(nextPosition.z-savedPosition.z)/IK_CONFIG.railSample));
    let blocked=false;
    for(let sample=1;sample<=samples;sample++) {
      controls.forEach((control,i)=>setJointAngle(control,MathUtils.lerp(savedAngles[i],nextAngles[i],sample/samples)));
      model.position.lerpVectors(savedPosition,nextPosition,sample/samples);
      model.updateWorldMatrix(true,true);
      if(collisions.collision()){blocked=true;break;}
    }
    if (blocked) {
      controls.forEach((control, i) => setJointAngle(control, savedAngles[i]));
      model.position.copy(savedPosition);
      model.updateWorldMatrix(true, true);
      collisions.syncHeld();
      return false;
    }
    if(progress===1 && pose.route && (pose.step ?? 0)<pose.route.length-1) pose.step=(pose.step ?? 0)+1;
    return true;
  }
  function isSettled(pose: IKPose) {
    return (!pose.route || (pose.step ?? 0)===pose.route.length-1) && controls.every((control, i) => Math.abs(control.angle - pose.angles[i]) < IK_CONFIG.settledAngle)
      && Math.abs(origin.z + pose.rail - model.position.z) < IK_CONFIG.settledRail;
  }
  return { plan, startPlan, advancePlan, animate, isSettled, collisions, carryRotation: uprightGripQuaternion.clone().invert(), grip, controls, solver, rail, effector };
}






