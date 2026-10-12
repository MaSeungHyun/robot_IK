import { Goal, Joint, Link, Solver } from "closed-chain-ik/core";
import * as IKCore from "closed-chain-ik/core";
import { Box3, Group, MathUtils, Mesh, Quaternion, Vector3, type Object3D } from "three";
import { createCollisionWorld } from "./collisions";
import { createJointControl, setJointAngle } from "./joints";
// Upstream declares a const enum although it exports a runtime object.
// Read the actual object without relying on const-enum inlining.
const DOF = (IKCore as unknown as { DOF: { X: 0; Y: 1; Z: 2; EX: 3; EY: 4; EZ: 5 } }).DOF;

type IKStep = { angles: number[]; rail: number };
export type IKPose = IKStep & { error: number; reachable: boolean; route?: IKStep[]; step?: number };

export function createRobotIK(model: Group) {
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
  const controls = [1, 2, 4].map(i => {
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
      joint.setDoF(DOF.EX);
      joint.setMinLimits(control.min - control.initialX);
      joint.setMaxLimits(control.max - control.initialX);
      hinges.push(joint);
    } else {
      joint.setDoF(); // hand03 and other fixed model transforms remain unchanged.
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
  solver.maxIterations = 180;
  solver.dampingFactor = 0.001;
  solver.translationConvergeThreshold = 0.004;
  solver.stallThreshold = 1e-6;
  solver.restPoseFactor = 0.001;
  const localTarget = new Vector3();
  const solvedPosition: number[] = [0,0,0];
  const armMeshes: Mesh[] = [];
  const wristMeshes: Mesh[] = [];
  model.traverse(node => {
    if (!(node instanceof Mesh)) return;
    let part: Object3D = node;
    while (part.parent && !/^hand0[1-5]$/.test(part.name)) part = part.parent;
    if (/^hand0[2-5]$/.test(part.name)) {
      node.geometry.computeBoundingBox();
      armMeshes.push(node);
      if (part.name === "hand04") wristMeshes.push(node);
    }
  });
  const bounds = new Box3();
  const samplePoint = new Vector3();

  function checkPath(angles: number[], destinationRail: number, target: Vector3, wristAbove: boolean, from?: IKStep, minimumY?: number) {
    const originalAngles = controls.map(c => c.angle);
    const originalPosition = model.position.clone();
    const savedAngles = from?.angles ?? originalAngles;
    const savedPosition = originalPosition.clone();
    if (from) savedPosition.z = origin.z + from.rail;
    controls.forEach((c,i) => setJointAngle(c,savedAngles[i]));
    model.position.copy(savedPosition);
    model.updateWorldMatrix(true, true);
    const minimumGripY = minimumY ?? Math.min(grip.getWorldPosition(samplePoint).y, target.y) - 0.025;
    const duration = Math.max(
      ...angles.map((a, i) => Math.abs(a - savedAngles[i]) / 1.8),
      Math.abs(origin.z + destinationRail - savedPosition.z) / 0.65,
    );
    let safe = true;
    let minimumHeight = Infinity;
    // Sample the same speed-limited trajectory used by animate(), not a
    // straight line between end-effector positions or just the endpoint.
    const samples = Math.max(1, Math.ceil(duration * 60),
      ...angles.map((a,i)=>Math.ceil(Math.abs(a-savedAngles[i])/0.01)),
      Math.ceil(Math.abs(origin.z+destinationRail-savedPosition.z)/0.005));
    for (let sample = 0; sample <= samples && safe; sample++) {
      const progress = sample / samples;
      controls.forEach((control, i) => setJointAngle(control, MathUtils.lerp(savedAngles[i], angles[i], progress)));
      model.position.z = MathUtils.lerp(savedPosition.z, origin.z + destinationRail, progress);
      model.updateWorldMatrix(true, true);
      const height = grip.getWorldPosition(samplePoint).y;
      minimumHeight = Math.min(minimumHeight, height);
      if (height < minimumGripY || collisions.collision()) safe = false;
      for (const mesh of armMeshes) {
        if (bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).min.y < 0.015) safe = false;
      }
      if (wristAbove && sample === samples) {
        if (wristNode.getWorldPosition(new Vector3()).y < height + 0.15) safe = false;
        for (const mesh of wristMeshes) {
          if (bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).min.y < height + 0.03) safe = false;
        }
      }
    }
    controls.forEach((control, i) => setJointAngle(control, originalAngles[i]));
    model.position.copy(originalPosition);
    model.updateWorldMatrix(true, true);
    collisions.syncHeld();
    return { safe, minimumHeight };
  }

  function findRoute(destination: IKStep, target: Vector3, wristAbove: boolean) {
    const start: IKStep = { angles: controls.map(c => c.angle), rail: model.position.z - origin.z };
    const minimumY = 0.25;
    if (!checkPath(destination.angles,destination.rail,target,wristAbove,destination,minimumY).safe) return null;
    // Try opposite shoulder/elbow bends before randomized exploration.
    // Coordinating hand04 cancels the bend's net orientation change while
    // cargo is attached, so the wrist does not sweep through the box.
    const reverse = destination.angles.map((a,i) => -Math.sign(a-start.angles[i] || 1));
    for (const magnitude of [Math.PI/6,Math.PI/3,Math.PI/2]) {
      for (const [a,b] of [[reverse[0],0],[0,reverse[1]],[reverse[0],reverse[1]],[-reverse[0],0],[0,-reverse[1]],[-reverse[0],-reverse[1]]]) {
        const shoulder=MathUtils.clamp(start.angles[0]+a*magnitude,controls[0].min,controls[0].max);
        const elbow=MathUtils.clamp(start.angles[1]+b*magnitude,controls[1].min,controls[1].max);
        const retreat: IKStep = { angles:[shoulder,elbow,start.angles[2]-(shoulder-start.angles[0])-(elbow-start.angles[1])],rail:start.rail };
        if (!checkPath(retreat.angles,retreat.rail,target,false,start,minimumY).safe) continue;
        if (checkPath(destination.angles,destination.rail,target,wristAbove,retreat,minimumY).safe) return [retreat,destination];
      }
    }
    const nodes: { state: IKStep; parent: number }[] = [{state:start,parent:-1}];
    let seed = 1234567;
    const random = () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
    const distance = (a:IKStep,b:IKStep) => a.angles.reduce((v,x,i)=>v+(x-b.angles[i])**2,0)+(a.rail-b.rail)**2;
    for(let iteration=0;iteration<1800;iteration++) {
      const sample: IKStep = random()<0.25 ? destination : {
        angles: [
          MathUtils.lerp(controls[0].min,controls[0].max,random()),
          MathUtils.lerp(controls[1].min,controls[1].max,random()),
          start.angles[2]+(random()*2-1)*2*Math.PI,
        ],
        rail: MathUtils.lerp(Math.min(start.rail,destination.rail)-0.5,Math.max(start.rail,destination.rail)+0.5,random()),
      };
      // Upright cargo leaves a narrow corridor in joint space. Sample
      // coordinated bends as well as unrestricted states, keeping the wrist
      // orientation between the current and desired downward orientations.
      if (random()<0.8 && sample!==destination) {
        const sum=MathUtils.lerp(start.angles.reduce((a,b)=>a+b,0),destination.angles.reduce((a,b)=>a+b,0),random());
        sample.angles[2]=sum-sample.angles[0]-sample.angles[1];
      }
      let nearest=0;
      for(let i=1;i<nodes.length;i++) if(distance(nodes[i].state,sample)<distance(nodes[nearest].state,sample)) nearest=i;
      const before=nodes[nearest].state;
      const fraction=Math.min(1,0.3/Math.sqrt(distance(before,sample)));
      const next: IKStep = {angles:before.angles.map((a,i)=>MathUtils.lerp(a,sample.angles[i],fraction)),rail:MathUtils.lerp(before.rail,sample.rail,fraction)};
      if(!checkPath(next.angles,next.rail,target,false,before,minimumY).safe) continue;
      nodes.push({state:next,parent:nearest});
      if(!checkPath(destination.angles,destination.rail,target,wristAbove,next,minimumY).safe) continue;
      const route=[destination];
      for(let i=nodes.length-1;i>0;i=nodes[i].parent) route.unshift(nodes[i].state);
      // Shortcut only when the entire replacement segment passes collision tests.
      const compact:IKStep[]=[]; let current=start, index=0;
      while(index<route.length) {
        let end=route.length-1;
        while(end>index && !checkPath(route[end].angles,route[end].rail,target,end===route.length-1&&wristAbove,current,minimumY).safe) end--;
        compact.push(route[end]);current=route[end];index=end+1;
      }
      return compact;
    }
    return null;
  }

  function plan(worldTarget: Vector3, wristAbove = false): IKPose {
    model.parent?.updateWorldMatrix(true, false);
    localTarget.copy(worldTarget);
    if (model.parent) model.parent.worldToLocal(localTarget);
    goal.setPosition(localTarget.x, localTarget.y, localTarget.z);
    goal.setGoalDoF(...(wristAbove ? [DOF.X, DOF.Y, DOF.Z, DOF.EX, DOF.EY, DOF.EZ] : [DOF.X, DOF.Y, DOF.Z]));
    const localQuaternion = uprightGripQuaternion.clone();
    if (model.parent) localQuaternion.premultiply(model.parent.getWorldQuaternion(new Quaternion()).invert());
    goal.setQuaternion(localQuaternion.x, localQuaternion.y, localQuaternion.z, localQuaternion.w);
    const saved = controls.map(c => c.angle - c.initialX);
    const currentRail = model.position.z - origin.z;
    let best: IKPose = { angles: controls.map(c => c.angle), rail: currentRail, error: Infinity, reachable: false };
    let bestCost = Infinity;
    const alternatives: (IKStep & {error:number})[] = [];
    function attempt(seed: number[], freezeWrist: boolean) {
      rail.setDoFValue(DOF.Z, currentRail);
      hinges.forEach((joint, i) => {
        const control = controls[i];
        joint.setMinLimits(i === 2 ? (freezeWrist ? saved[i] : saved[i] - 2 * Math.PI) : control.min - control.initialX);
        joint.setMaxLimits(i === 2 ? (freezeWrist ? saved[i] : saved[i] + 2 * Math.PI) : control.max - control.initialX);
        joint.setDoFValue(DOF.EX, seed[i]);
        joint.setRestPoseValue(DOF.EX, saved[i]);
        joint.restPoseSet = true;
      });
      root.updateMatrixWorld();
      solver.solve();
      effector.getWorldPosition(solvedPosition);
      const error = localTarget.distanceTo(new Vector3().fromArray(solvedPosition));
      const offsets = hinges.map(j => Number(j.getDoFValue(DOF.EX)));
      const reachable = error < 0.015;
      const angles = offsets.map((v, i) => v + controls[i].initialX);
      const railPosition = Number(rail.getDoFValue(DOF.Z));
      const trajectory = reachable ? checkPath(angles, railPosition, worldTarget, wristAbove) : { safe: false, minimumHeight: 0 };
      if (reachable && !trajectory.safe && !alternatives.some(a => a.angles.every((v,i)=>Math.abs(v-angles[i])<0.1))) alternatives.push({angles,rail:railPosition,error});
      const travel = offsets.reduce((sum, v, i) => sum + (v - saved[i]) ** 2 * (i === 2 ? 4 : 1), 0);
      const cost = reachable && trajectory.safe ? travel : 100000 + error;
      if (cost < bestCost) {
        bestCost = cost;
        best = { angles, rail: railPosition, error, reachable: reachable && trajectory.safe };
      }
    }
    // Warm start, then alternate shoulder/elbow seeds if necessary. Every
    // candidate is solved by the library, within its configured limits.
    attempt(saved, true);
    const shoulderSeeds = [-75, 0, 75].map(MathUtils.degToRad);
    const elbowSeeds = [-220, -145, -65].map(MathUtils.degToRad);
    if (!best.reachable) {
      for (const a of shoulderSeeds) for (const b of elbowSeeds) {
        attempt([a - controls[0].initialX, b - controls[1].initialX, saved[2]], true);
      }
    }
    if (!best.reachable) {
      for (const a of shoulderSeeds) for (const b of elbowSeeds) for (const w of [0, -Math.PI / 2, Math.PI / 2, -Math.PI, Math.PI]) {
        attempt([a - controls[0].initialX, b - controls[1].initialX, saved[2] + w], false);
      }
    }
    if (!best.reachable) {
      for (const candidate of alternatives.sort((a,b)=>a.angles.reduce((sum,v,i)=>sum+(v-controls[i].angle)**2,0)-b.angles.reduce((sum,v,i)=>sum+(v-controls[i].angle)**2,0)).slice(0,12)) {
        const route=findRoute(candidate,worldTarget,wristAbove);
        if(route) {best={...candidate,reachable:true,route,step:0};break;}
      }
    }
    return best;
  }

  function animate(pose: IKPose, dt: number) {
    if (!pose.reachable) return false;
    const target = pose.route?.[pose.step ?? 0] ?? pose;
    const savedAngles = controls.map(c => c.angle);
    const savedPosition = model.position.clone();
    // All motors share the same progress fraction. In this planar chain,
    // matching start/end wrist orientation then preserves it while lowering.
    const remainingDuration = Math.max(
      ...controls.map((control, i) => Math.abs(target.angles[i] - control.angle) / 1.8),
      Math.abs(origin.z + target.rail - model.position.z) / 0.65,
    );
    const progress = remainingDuration > 0 ? Math.min(1, dt / remainingDuration) : 1;
    controls.forEach((control, i) => {
      setJointAngle(control, MathUtils.lerp(control.angle, target.angles[i], progress));
    });
    model.position.z = MathUtils.lerp(model.position.z, origin.z + target.rail, progress);
    model.updateWorldMatrix(true, true);
    const nextAngles=controls.map(c=>c.angle), nextPosition=model.position.clone();
    const samples=Math.max(1,...nextAngles.map((a,i)=>Math.ceil(Math.abs(a-savedAngles[i])/0.01)),Math.ceil(Math.abs(nextPosition.z-savedPosition.z)/0.005));
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
    return (!pose.route || (pose.step ?? 0)===pose.route.length-1) && controls.every((control, i) => Math.abs(control.angle - pose.angles[i]) < 0.002)
      && Math.abs(origin.z + pose.rail - model.position.z) < 0.001;
  }
  return { plan, animate, isSettled, collisions, carryRotation: uprightGripQuaternion.clone().invert(), grip, controls, solver, rail, effector };
}






