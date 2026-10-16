import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as T from 'three';

// Read actual GLB triangle geometry without decoding textures, preserving
// model transforms and exercising the same BVH collision tests as the app.
function load(name, nativeMeshNodes = false) {
  const buffer = fs.readFileSync(`src/assets/models/${name}.glb`);
  const gltf = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
  const binaryStart = 28 + buffer.readUInt32LE(12);
  function accessor(index) {
    const a=gltf.accessors[index], v=gltf.bufferViews[a.bufferView];
    const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
    const bytes=a.componentType===5126||a.componentType===5125?4:2;
    const array=a.componentType===5126?new Float32Array(a.count*components):a.componentType===5125?new Uint32Array(a.count*components):new Uint16Array(a.count*components);
    for(let i=0;i<a.count;i++)for(let k=0;k<components;k++){
      const offset=binaryStart+(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||bytes*components)+k*bytes;
      array[i*components+k]=a.componentType===5126?buffer.readFloatLE(offset):a.componentType===5125?buffer.readUInt32LE(offset):buffer.readUInt16LE(offset);
    }
    return new T.BufferAttribute(array,components);
  }
  const nodes = gltf.nodes.map(node => {
    let group = new T.Group(); group.name = node.name;
    if (node.translation) group.position.fromArray(node.translation);
    if (node.rotation) group.quaternion.fromArray(node.rotation);
    if (node.scale) group.scale.fromArray(node.scale);
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
      const geometry=new T.BufferGeometry();
      geometry.setAttribute('position',accessor(primitive.attributes.POSITION));
      if(primitive.indices!==undefined)geometry.setIndex(accessor(primitive.indices));
      const mesh=new T.Mesh(geometry);
      if(nativeMeshNodes&&gltf.meshes[node.mesh].primitives.length===1){
        mesh.name=group.name;mesh.position.copy(group.position);mesh.quaternion.copy(group.quaternion);mesh.scale.copy(group.scale);group=mesh;
      }else group.add(mesh);
    }
    return group;
  });
  gltf.nodes.forEach((node, i) => node.children?.forEach(child => nodes[i].add(nodes[child])));
  const root = new T.Group(); gltf.scenes[gltf.scene || 0].nodes.forEach(i => root.add(nodes[i]));
  return root;
}
const output = path.resolve('.tmp/ik-tests'); fs.mkdirSync(output,{recursive:true});
const sourcePaths = {
  constants: 'src/constants/simulation.ts',
  conveyor: 'src/features/conveyor/conveyor.ts',
  ...Object.fromEntries(['joints','collisions','robotKinematics','robotIK','heldBoxCollision','picking','motionTiming'].map(name => [name, `src/utils/robot/${name}.ts`])),
  ...Object.fromEntries(['packingDiagnostics','perfectTiling','tiling','onlinePacking','fixedLayerPacking'].map(name => [name, `src/utils/packing/${name}.ts`])),
};
for (const name of Object.keys(sourcePaths)) {
  const source = fs.readFileSync(sourcePaths[name], "utf8").replace(/from "(?:\.\.?\/)+[^"\n]+"/g, spec => spec.replace(/"[^"\n]+"/, value => `"./${path.basename(value.slice(1, -1)).replace("simulation", "constants")}.mjs"`));
  fs.writeFileSync(path.join(output,`${name}.mjs`),ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}));
}
const { createRobotIK } = await import(new URL('../.tmp/ik-tests/robotIK.mjs',import.meta.url));
const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm,'').replaceAll('export ','');
const compile = source => ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
let demoSource = strip(fs.readFileSync('src/features/Viewport/index.tsx','utf8'));
demoSource = demoSource.slice(0,demoSource.indexOf('default function Viewport'));
demoSource = demoSource.slice(0,demoSource.lastIndexOf('  return ('))+'return demo;}';
const stacking = compile(strip(fs.readFileSync('src/utils/packing/stacking.ts','utf8')));
const makeDemo = new Function('useGLTF','useMemo','useRef','useEffect','Box3','Group','Vector3','boxUrl','palletUrl',stacking+compile(demoSource)+';return Demo({running:true,onProgress:()=>{}});');
const { MOTION, IK_CONFIG, COLLISION, PACKING, ROBOT_PICKING } = await import(new URL('../.tmp/ik-tests/constants.mjs',import.meta.url));
const { isPickupInRange, isWristAboveBox, setCargoWorldPose } = await import(new URL('../.tmp/ik-tests/picking.mjs',import.meta.url));
const { minimumJerk } = await import(new URL('../.tmp/ik-tests/motionTiming.mjs',import.meta.url));
const { setJointAngle, createJointControl, blenderWorldX } = await import(new URL('../.tmp/ik-tests/joints.mjs',import.meta.url));
const controllerSource = compile(strip(fs.readFileSync('src/features/robots/SuctionRobotController.ts', 'utf8')));
function controllerClass(createIK = createRobotIK) {
  return new Function('createRobotIK','MOTION','IK_CONFIG','ROBOT_PICKING','Group','Quaternion','Vector3','Euler','setJointAngle','isPickupInRange','isWristAboveBox','setCargoWorldPose','minimumJerk',
    controllerSource+';return SuctionRobotController;')(createIK,MOTION,IK_CONFIG,ROBOT_PICKING,T.Group,T.Quaternion,T.Vector3,T.Euler,setJointAngle,isPickupInRange,isWristAboveBox,setCargoWorldPose,minimumJerk);
}
const controllers = new WeakMap();
const makeRobot = (useGLTF, useMemo, useRef, useFrame, Group, Quaternion, Vector3, robot, createIK, jobs, report, options = {}) => {
  const model = useGLTF(robot).scene.clone(true);
  const geometryScale = options.geometryScale ?? 1;
  if (geometryScale !== 1) model.traverse(node => {
    node.position.multiplyScalar(geometryScale);
    if (node.isMesh) {
      node.geometry = node.geometry.clone();
      node.geometry.scale(geometryScale,geometryScale,geometryScale);
    }
  });
  const Controller = controllerClass(createIK);
  const controller = new Controller({ id: 'fixture', model, geometryScale, getJobs: () => jobs.current,
    getObstacles: () => options.obstacles?.current ?? jobs.current.map(job => job.box), onProgress: report });
  controller.start();
  controllers.set(model,controller);
  useFrame((_, delta) => controller.update(delta));
  return model;
};
// Exercise the public contract using separate copies of the actual robot GLB.
{
  const origin = new T.Vector3(4,0,-2);
  if (!isPickupInRange(origin,new T.Vector3(5,1,-2),undefined,1,0.2)) throw Error('Pickup radius boundary rejected');
  if (isPickupInRange(origin,new T.Vector3(5.1,1,-2),undefined,1,0.2)) throw Error('Box outside radius accepted');
  if (isPickupInRange(origin,new T.Vector3(4.9,1,-2),new T.Vector3(1,0,0),1,0.2)) throw Error('Predicted exit from radius accepted');
  const parent = new T.Group(), grip = new T.Group(), box = new T.Group();
  parent.position.set(3,0,-2); parent.rotation.y = 0.7; parent.scale.setScalar(2);
  parent.add(box); grip.attach(box);
  const destination = new T.Vector3(7,2,-4), yaw = 0.3;
  parent.attach(box);
  setCargoWorldPose(box,parent,destination,new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw));
  if (box.parent !== parent || box.getWorldPosition(new T.Vector3()).distanceTo(destination) > 1e-6) throw Error('Release ignored the transformed parent');
  if (box.getWorldQuaternion(new T.Quaternion()).angleTo(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw)) > 1e-6) throw Error('Release used local instead of world yaw');
  console.log('Picking: current/predicted radius and release under a transformed parent passed');
}
{
  const Controller = controllerClass();
  const first = new Controller({ id: 'robot-a', model: load('robot'), getJobs: () => [] });
  const second = new Controller({ id: 'robot-b', model: load('robot'), getJobs: () => [] });
  const initial = first.getJointAngles();
  const other = second.getJointAngles();
  first.start();
  second.start();
  first.setJointAngle('hand01', 25);
  if (first.running || !second.running) throw Error('Manual control must pause only its own robot');
  first.update(0);
  if (Math.abs(first.getJointAngles().find(angle => angle.name === 'hand01').degrees - 25) > 1e-6) throw Error('Manual angle was not applied');
  if (second.getJointAngles().some((angle, index) => Math.abs(angle.degrees - other[index].degrees) > 1e-6)) throw Error('Controllers share joint state');
  first.setJointAngle('hand01', 9999);
  first.update(0);
  const limited = first.getJointAngles().find(angle => angle.name === 'hand01');
  if (limited.degrees > limited.max + 1e-6) throw Error('Controller bypassed joint limits');
  first.reset();
  if (first.running || first.getJointAngles().some((angle, index) => Math.abs(angle.degrees - initial[index].degrees) > 1e-6)) throw Error('Reset did not restore the initial joint pose');
  first.dispose(); first.dispose(); first.start(); first.setJointAngle('hand01', 30); first.update(1);
  if (first.running || first.getJointAngles().some((angle, index) => Math.abs(angle.degrees - initial[index].degrees) > 1e-6)) throw Error('Disposed controller still operates');
  second.pause(); second.update(1); second.dispose();
  let events = 0;
  const waiting = new Controller({ id: 'out-of-range', model: load('robot'), pickupRadius: 0.1,
    getJobs: () => [{ box: new T.Group(), pickup: new T.Vector3(1,0.45,0), destination: new T.Vector3(), onPick: () => events++ }],
    onProgress: () => events++,
  });
  waiting.start(); waiting.update(0.05);
  if (events !== 0) throw Error('Out-of-radius box started a pickup');
  waiting.dispose();
  console.log('RobotController: independent instances, manual pause, joint limits, reset and disposal passed');
}
{
  const Controller = controllerClass();
  const model = load('robot'), parent = new T.Group(), box = new T.Group();
  parent.position.set(2, 0, -1); parent.add(box); box.position.set(1, 0.3, 0);
  const origin = box.position.clone();
  let jobs = [];
  const controller = new Controller({ id: 'cargo', model, getJobs: () => jobs });
  jobs = [{ box, pickup: new T.Vector3(1,0.45,0), destination: new T.Vector3(), available: () => true }];
  controller.start(); controller.update(0);
  box.position.set(4, 5, 6);
  controller.reset();
  if (box.parent !== parent || box.position.distanceTo(origin) > 1e-6) throw Error('Reset lost cargo transform');
  jobs[0].available = () => true;
  controller.start(); controller.update(0);
  model.getObjectByName('GripPoint').attach(box);
  const heldPosition = box.getWorldPosition(new T.Vector3());
  jobs = []; // Cleanup must work even if the queue owner already cleared it.
  controller.dispose();
  if (box.parent !== parent || box.getWorldPosition(new T.Vector3()).distanceTo(heldPosition) > 1e-6) throw Error('Dispose lost held cargo or changed its world position');
  console.log('RobotController: live queue, cargo reset and held-cargo cleanup passed');
}
{
  const ik=createRobotIK(load('robot'),1,'held-box-hand03');
  const pose={baseYaw:ik.baseControl.angle+0.4,angles:ik.controls.map(c=>c.angle),error:0,reachable:true};
  const speeds=[];const dt=0.005;
  for(let frame=0;frame<1000&&!ik.isEasedSettled(pose);frame++){
    const before=ik.baseControl.angle;
    if(!ik.animateEased(pose,dt))throw Error('Eased trajectory rejected a collision-free base turn');
    speeds.push(Math.abs(ik.baseControl.angle-before)/dt);
  }
  const peak=Math.max(...speeds);
  if(!ik.isEasedSettled(pose)||peak>MOTION.baseAngularSpeed+1e-6)throw Error('Easing exceeded speed limit or failed to finish');
  if(speeds[0]>peak*0.01||speeds.at(-1)>peak*0.01)throw Error('Eased movement did not start and finish at rest');
  console.log('Minimum-jerk motion: actual joint trajectory respects speed limit and stops smoothly');
}
for (const fps of process.argv.includes("--legacy")?[30,60]:[]) {
  const demo = makeDemo(url=>({scene:load(url)}),f=>f(),v=>({current:v}),()=>{},T.Box3,T.Group,T.Vector3,'box','pallet');
  let frame, ik, completed = 0, minimumGripY = -Infinity, lowering = false, batchStatus="";
  const model = makeRobot(()=>({scene:load('robot')}),f=>f(),v=>({current:v}),f=>{frame=f;},T.Group,T.Quaternion,T.Vector3,'',m=>{
    ik=createRobotIK(m);
    const plan=ik.plan;
    ik.plan=(target,...options)=>{
      m.updateWorldMatrix(true,true);
      minimumGripY=Math.min(ik.grip.getWorldPosition(new T.Vector3()).y,target.y)-0.025;
      const oldAngles=ik.controls.map(c=>c.angle), oldPosition=m.position.clone();
      lowering=Boolean(options[0]) && Boolean(demo.transfers[completed]) && target.distanceTo(demo.transfers[completed].destination)<1e-6;
      const pose=plan(target,...options); if(pose.route) minimumGripY=0.25;

      if (m.position.distanceTo(oldPosition)>1e-8 || ik.controls.some((c,i)=>Math.abs(c.angle-oldAngles[i])>1e-8)) throw Error('Planning changed displayed pose');
      return pose;
    };
    return ik;
  },{current:demo.transfers},(count,status)=>{completed=count;batchStatus=status;});
  const world = new T.Group(); world.add(demo.root,model);
  const movingArmMeshes=[];
  model.traverse(node=>{
    if (node instanceof T.Mesh && /^hand0[2-5]$/.test(node.parent?.name)) movingArmMeshes.push(node);
  });
  // The library chain must exactly match the displayed GLB at rest.
  const position = [0,0,0]; ik.effector.updateMatrixWorld(); ik.effector.getWorldPosition(position);
  if (ik.grip.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(position)) > 1e-5) throw Error('IK/GLB transform mismatch');
  for (let i=0;i<fps*600 && completed<10;i++) {
    const previouslyCompleted=completed;
    frame(null,1/fps);
    if (ik.collisions.collision()) throw Error(`Collision during animation: ${ik.collisions.lastHit}, completed=${completed}, tip=${ik.grip.getWorldPosition(new T.Vector3()).toArray()}`);
    if (lowering || completed>previouslyCompleted) {
      const wristBounds=new T.Box3();
      for(const mesh of movingArmMeshes) {
        if(mesh.parent?.name==='hand04') wristBounds.union(new T.Box3().setFromObject(mesh));
      }
      const cargoTop=ik.grip.getWorldPosition(new T.Vector3()).y;
      if(wristBounds.min.y<cargoTop+0.03-1e-6) throw Error('hand04 intruded into cargo while lowering');
      if(model.getObjectByName('hand04').getWorldPosition(new T.Vector3()).y<cargoTop+0.15-1e-6) throw Error('Wrist is not above cargo');
    }

    if (ik.grip.getWorldPosition(new T.Vector3()).y<minimumGripY-1e-6) throw Error('Grip dipped below approach clearance');
    for (const mesh of movingArmMeshes) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const floorHeight=new T.Box3().copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld).min.y;
      if (floorHeight<0.015-1e-6) throw Error('Arm crossed floor clearance');
    }
    for (const control of ik.controls.slice(0,2)) {
      if (control.angle<control.min-1e-6 || control.angle>control.max+1e-6) throw Error('Joint limit exceeded');
    }
  }
  const placed = demo.transfers.filter(job=>job.box.getWorldPosition(new T.Vector3()).distanceTo(job.destination)<1e-5).length;
  if (placed!==10 || completed!==10) throw Error(`Only ${placed}/10 placed at ${fps} fps: ${batchStatus}`);
  // A distant goal must fail rather than attach/move to a fabricated pose.
  if (ik.plan(new T.Vector3(100,100,100)).reachable) throw Error('Unreachable goal accepted');
  ik.collisions.setContext({boxes:[],active:demo.transfers[9].box,carrying:false});
  const safePose=ik.plan(ik.grip.getWorldPosition(new T.Vector3()).add(new T.Vector3(0,0.12,0)));
  if(!safePose.reachable) throw Error('Runtime collision fixture has no initial plan');
  const deferred=ik.startPlan(ik.grip.getWorldPosition(new T.Vector3()).add(new T.Vector3(0,0.12,0)));
  if(ik.advancePlan(deferred,0,0)?.reason!=='timeout')throw Error('Budget was not distinguished from collision');
  let resumed;
  for(let n=0;n<10000&&!resumed;n++){const result=deferred.next();if(result.done)resumed=result.value;}
  if(!resumed?.reachable)throw Error('Timed-out safe plan could not resume');
  const blocker=new T.Group(); blocker.add(new T.Mesh(new T.BoxGeometry(1,1.2,1)));
  const base=model.getObjectByName('base');
  blocker.position.copy(new T.Box3().setFromObject(base).getCenter(new T.Vector3()));
  world.add(blocker);
  ik.collisions.setContext({boxes:[blocker],active:demo.transfers[9].box,carrying:false});
  if(!ik.collisions.collision()) throw Error('Robot/body collision was not detected');
  const beforeAngles=ik.controls.map(c=>c.angle), beforePosition=model.position.clone();
  if(ik.animate(safePose,1/fps)) throw Error('Runtime obstacle did not stop animation');
  if(model.position.distanceTo(beforePosition)>1e-8 || ik.controls.some((c,i)=>Math.abs(c.angle-beforeAngles[i])>1e-8)) throw Error('Collision rollback failed');
  world.remove(blocker);
  const held=demo.transfers[9].box;
  const duplicate=held.clone(true);
  duplicate.position.copy(held.getWorldPosition(new T.Vector3()));
  duplicate.quaternion.copy(held.getWorldQuaternion(new T.Quaternion()));
  world.add(duplicate);ik.grip.attach(held);
  ik.collisions.setContext({boxes:[held,duplicate],active:held,carrying:true});
  if(!ik.collisions.collision()) throw Error('Held/placed cargo overlap was not detected');
  console.log(`${fps} fps: 10/10 collision-free transfers; limits, wrist placement, body/cargo obstacles and runtime rollback passed`);
}






const rollModel=load('robot'),rollWorld=new T.Group();rollWorld.add(rollModel);
const rollIK=createRobotIK(rollModel),roll=rollIK.controls.find(c=>c.node.name==='hand03');
// The new model's hand00 is local Y (Blender Z), not a translating root.
const baseStart=rollIK.baseControl.angle,rootStart=rollModel.position.clone();
const baseRest=rollIK.baseControl.rest.clone();
setJointAngle(rollIK.baseControl,baseStart+Math.PI/2);
const expectedBase=baseRest.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.PI/2));
if(rollIK.baseControl.node.quaternion.clone().normalize().angleTo(expectedBase.normalize())>1e-6||rollModel.position.distanceTo(rootStart)>1e-8)throw Error('hand00 did not rotate about local Y with a fixed root');
setJointAngle(rollIK.baseControl,baseStart);
setJointAngle(rollIK.baseControl,baseStart+.4);rollModel.updateWorldMatrix(true,true);
const rotatedTarget=rollIK.grip.getWorldPosition(new T.Vector3());
setJointAngle(rollIK.baseControl,baseStart);rollModel.updateWorldMatrix(true,true);
const yawPlan=rollIK.plan(rotatedTarget);
if(!yawPlan.reachable)throw Error('hand00 rotation target could not be solved: '+yawPlan.blockedBy);
if(Math.abs(rollIK.baseControl.angle-baseStart)>1e-8||rollModel.position.distanceTo(rootStart)>1e-8)throw Error('Base yaw planning mutated visible pose');
for(let frame=0;frame<1200&&!rollIK.isSettled(yawPlan);frame++)if(!rollIK.animate(yawPlan,1/60))throw Error('Base yaw motion unexpectedly blocked');
if(!rollIK.isSettled(yawPlan)||rollIK.grip.getWorldPosition(new T.Vector3()).distanceTo(rotatedTarget)>.02||Math.abs(rollIK.baseControl.angle-baseStart)<.05)throw Error('hand00 did not reach the off-plane target');
if(rollModel.position.distanceTo(rootStart)>1e-8)throw Error('Base yaw animation translated root');
// Reset for the independent hand03 and collision fixtures.
setJointAngle(rollIK.baseControl,baseStart);rollIK.controls.forEach(c=>setJointAngle(c,c.initialX));rollModel.updateWorldMatrix(true,true);
console.log('hand00: local Y rotation, off-plane IK, pose restoration and fixed robot position passed');

const active=new T.Group();active.add(new T.Mesh(new T.BoxGeometry(.1,.1,.1).translate(0,-.05,0)));active.position.set(100,100,100);rollWorld.add(active);
rollIK.collisions.setContext({boxes:[],active,carrying:false});
const rollRest=roll.node.quaternion.clone();
for(const offset of [Math.PI/2,-Math.PI/2,2*Math.PI,-2*Math.PI]){
 setJointAngle(roll,roll.initialX+offset);
 if(!roll.locked||Math.abs(roll.angle-roll.initialX)>1e-8||roll.node.quaternion.clone().normalize().angleTo(rollRest.clone().normalize())>1e-6)throw Error('hand03 moved despite being locked');
}
const rollPose={angles:rollIK.controls.map(c=>c.angle),baseYaw:rollIK.baseControl.angle,error:0,reachable:true};rollPose.angles[3]+=Math.PI/2;
if(rollIK.animate(rollPose,10)||Math.abs(roll.angle-roll.initialX)>1e-8)throw Error('Animation bypassed the hand03 lock');
const wristControl=rollIK.controls[2];
for(const degrees of [-720,-360,-100,0,80,360,720]){
 setJointAngle(wristControl,T.MathUtils.degToRad(degrees));
 if(Math.abs(wristControl.angle-T.MathUtils.degToRad(degrees))>1e-8)throw Error('hand04 full-turn rotation was clamped');
}
setJointAngle(wristControl,wristControl.initialX);
const wristMesh=[];rollModel.getObjectByName('hand04').traverse(n=>{if(n.isMesh)wristMesh.push(n);});
for(const name of ['hand00','hand02']){
  const node=new T.Group();node.name=name;const control=createJointControl(node);
  setJointAngle(control,T.MathUtils.degToRad(179));const before=node.quaternion.clone();
  setJointAngle(control,T.MathUtils.degToRad(181));
  if(Math.abs(control.angle-T.MathUtils.degToRad(181))>1e-8||Math.abs(before.angleTo(node.quaternion)-T.MathUtils.degToRad(2))>1e-6)throw Error(name+' full-turn seam clamped');
}
console.log('hand03: manual and animation lock; hand04: continuous 360 degree rotation passed');

// Independent numerical FK/IK regressions on the real hierarchy and transformed root.
const {createKinematics,solvePosition}=await import(new URL('../.tmp/ik-tests/robotKinematics.mjs',import.meta.url));
const {NUMERICAL_IK}=await import(new URL('../.tmp/ik-tests/constants.mjs',import.meta.url));
const numericModel=load('robot'), numericParent=new T.Group();numericParent.position.set(.1,.2,-.3);numericParent.rotation.y=.35;numericParent.add(numericModel);
const numericIK=createRobotIK(numericModel),numericControls=[numericIK.baseControl,...numericIK.controls];
const reference=numericControls.map(c=>c.angle);
const changed=reference.map((value,i)=>Math.max(numericControls[i].min,Math.min(numericControls[i].max,value+[.2,-.1,.2,-.1,.3][i])));
numericControls.forEach((c,i)=>setJointAngle(c,changed[i]));numericModel.updateWorldMatrix(true,true);
const fk=createKinematics(numericControls,numericIK.grip,numericModel.getObjectByName('hand04'));
const exactTip=numericIK.grip.getWorldPosition(new T.Vector3()),calculated=fk.forward(changed);
if(calculated.position.distanceTo(exactTip)>1e-7||calculated.rotation.angleTo(numericIK.grip.getWorldQuaternion(new T.Quaternion()).normalize())>1e-6)throw Error('Detached FK differs from GLB under transformed parent');
numericControls.forEach((c,i)=>setJointAngle(c,reference[i]));numericModel.updateWorldMatrix(true,true);
const numericLimits=numericControls.map((c,i)=>[Number.isFinite(c.min)?c.min:reference[i]-Math.PI,Number.isFinite(c.max)?c.max:reference[i]+Math.PI]);
function finishNumerical(generator){for(;;){const result=generator.next();if(result.done)return result.value;}}
const measuredBefore=numericIK.grip.getWorldPosition(new T.Vector3());
const solved=finishNumerical(solvePosition(fk.forward,reference,numericLimits,exactTip,false,NUMERICAL_IK.positionTolerance,.1));
if(!solved.converged||fk.forward(solved.angles).position.distanceTo(exactTip)>NUMERICAL_IK.positionTolerance)throw Error('Numerical IK failed FK-generated reachable target');
if(numericIK.grip.getWorldPosition(new T.Vector3()).distanceTo(measuredBefore)>1e-8)throw Error('Numerical exploration changed displayed pose');
const outside=finishNumerical(solvePosition(fk.forward,reference,numericLimits,new T.Vector3(100,100,100),false,NUMERICAL_IK.positionTolerance,.1));
if(outside.converged)throw Error('Numerical IK accepted unreachable target');
const releaseRange=IK_CONFIG.releaseWorldXDegrees.map(T.MathUtils.degToRad);
for(const [degrees,allowed] of [[-101,false],[-100,true],[0,true],[80,true],[81,false]]){
 const worldX=blenderWorldX(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),T.MathUtils.degToRad(degrees)));
 const accepted=worldX>=releaseRange[0]-1e-8&&worldX<=releaseRange[1]+1e-8;
 if(accepted!==allowed)throw Error('Release world-X boundary check failed');
}
const releaseSolve=finishNumerical(solvePosition(angles=>({position:new T.Vector3(),rotation:new T.Quaternion(),direction:new T.Vector3(0,-1,0),wristRotation:new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),angles[0])}),[T.MathUtils.degToRad(120)],[[-Math.PI,Math.PI]],new T.Vector3(),false,.00015,0,releaseRange));
if(!releaseSolve.converged)throw Error('World release range could not be solved');
console.log('Release world X: -100..80 accepted only as a placement condition, independent of local turns');
console.log('Numerical IK: FK/GLB parity, transformed parent, reachable target, unreachable target and zero scene mutation passed');

// A held box is a rigid child of GripPoint, not a world-upright object.
const rigidModel=load('robot'),rigidIK=createRobotIK(rigidModel);
const rigidCargo=new T.Group();rigidCargo.add(new T.Mesh(new T.BoxGeometry(.22,.2,.275).translate(0,-.1,0)));
rigidIK.grip.add(rigidCargo);rigidCargo.position.set(0,0,0);
const shaft=rigidIK.grip.getWorldPosition(new T.Vector3()).sub(rigidModel.getObjectByName('hand04').getWorldPosition(new T.Vector3())).normalize();
const cargoWorld=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,-1,0),shaft);
rigidCargo.quaternion.copy(rigidIK.grip.getWorldQuaternion(new T.Quaternion()).invert()).multiply(cargoWorld);
rigidCargo.updateWorldMatrix(true,true);
const rigidLocal=rigidCargo.quaternion.clone(),rigidPosition=rigidCargo.position.clone();
const wristRelative=new T.Matrix4().copy(rigidModel.getObjectByName('hand04').matrixWorld).invert().multiply(rigidCargo.matrixWorld);
rigidIK.collisions.setContext({boxes:[rigidCargo],active:rigidCargo,carrying:true});
for(const degrees of [-720,-360,-100,-80,0,80,180,360,720]){
 setJointAngle(rigidIK.controls[2],T.MathUtils.degToRad(degrees));rigidModel.updateWorldMatrix(true,true);rigidIK.collisions.syncHeld();
 if(rigidCargo.quaternion.angleTo(rigidLocal)>1e-6||rigidCargo.position.distanceTo(rigidPosition)>1e-8)throw Error('Held cargo changed its local attachment pose');
 const relative=new T.Matrix4().copy(rigidModel.getObjectByName('hand04').matrixWorld).invert().multiply(rigidCargo.matrixWorld);
 if(relative.elements.some((value,i)=>Math.abs(value-wristRelative.elements[i])>1e-6))throw Error('hand04/cargo relative transform changed');
 const hit=rigidIK.collisions.collision();if(hit?.includes('운반 박스와 hand04'))throw Error('Rigid wrist turn introduced a false hand04/cargo collision');
}
if(rigidCargo.getWorldQuaternion(new T.Quaternion()).angleTo(cargoWorld)<.1)throw Error('Held cargo was incorrectly kept upright in world coordinates');
console.log('Rigid grasp: hand04 sweep preserves box attachment and cannot introduce wrist/box penetration');

// GLTFLoader creates a named Mesh for single-primitive nodes, rather than a Group wrapping that Mesh.
{
  const model=load('robot',true),ik=createRobotIK(model,1,'held-box-hand03');
  if(!model.getObjectByName('hand03').isMesh)throw Error('Native GLTF hand03 fixture is not a Mesh');
  const cargo=new T.Group();cargo.add(new T.Mesh(new T.BoxGeometry(.44,.4,.55).translate(0,-.2,0)));
  ik.grip.add(cargo);ik.collisions.setHeld(cargo);
  setJointAngle(ik.controls[2],T.MathUtils.degToRad(-30));
  if(!ik.collisions.collision()?.includes('hand03'))throw Error('The actual hand03 Mesh was excluded from collision detection');
  ik.collisions.setHeld(null);
  if(ik.collisions.collision())throw Error('Released box still collides in native GLTF fixture');
  console.log('Native GLTF Mesh nodes: hand03 itself participates in held-box collision detection');
}

// Actual GLB: the short wrist sweep crosses hand03, while the reverse solution
// keeps the payload clear and hand04 higher than the box on every sampled frame.
{
  const model = load('robot'), ik = createRobotIK(model,1,'held-box-hand03');
  const cargo = new T.Group();
  cargo.add(new T.Mesh(new T.BoxGeometry(.44,.4,.55).translate(0,-.2,0)));
  ik.grip.add(cargo); ik.collisions.setHeld(cargo);
  setJointAngle(ik.controls[2],T.MathUtils.degToRad(-30));
  if (!ik.collisions.collision()?.includes('hand03')) throw Error('Held-box/hand03 overlap was missed');
  ik.collisions.setHeld(null);
  if (ik.collisions.collision()) throw Error('Released cargo still participates in wrist collision');
  ik.collisions.setHeld(cargo);
  setJointAngle(ik.controls[2],T.MathUtils.degToRad(-120));
  if (ik.collisions.isWristAboveHeld()) throw Error('Wrist-below-box pose was accepted');
  setJointAngle(ik.controls[2],T.MathUtils.degToRad(30));
  const target = ik.grip.getWorldPosition(new T.Vector3());
  setJointAngle(ik.controls[2],T.MathUtils.degToRad(-60));
  const startAngle = ik.controls[2].angle;
  const displayed = [ik.baseControl,...ik.controls].map(control => control.angle);
  const pose = ik.plan(target);
  if (pose.reachable && pose.angles[2]-startAngle >= -Math.PI && !pose.route) throw Error('Blocked wrist sweep did not select a reverse turn or detour');
  if (!pose.reachable && !pose.blockedBy) throw Error('Locked-roll rejection did not explain the failed constraint');
  if ([ik.baseControl,...ik.controls].some((control,index) => Math.abs(control.angle-displayed[index])>1e-8)) throw Error('Wrist planning changed the displayed pose');
  for (let frame=0;pose.reachable&&frame<3000&&!ik.isSettled(pose);frame++) {
    if (!ik.animate(pose,1/60) || ik.collisions.collision() || !ik.collisions.isWristAboveHeld()) throw Error('Reverse turn collided or lowered hand04 beneath the box');
  }
  if (pose.reachable && (!ik.isSettled(pose) || ik.grip.getWorldPosition(new T.Vector3()).distanceTo(target)>MOTION.contactTolerance)) throw Error('Reverse wrist turn did not reach its target');
  if (!pose.reachable && ik.animate(pose,1/60)) throw Error('Unsafe reversal moved despite the hand03 lock');
  if (Math.abs(ik.controls[3].angle-ik.controls[3].initialX)>1e-8) throw Error('Wrist avoidance rotated locked hand03');
  console.log('Held-box/hand03: overlap detection, locked-roll safe reversal/rejection, invisible planning and wrist-above-box motion passed');
}

// Controlled two-sided barriers isolate retry behavior; real mesh safety is checked above and in the stream fixture.
{
  const model=load('robot'),ik=createRobotIK(model,1,'held-box-hand03');
  const cargo=new T.Group();ik.grip.add(cargo);ik.collisions.setHeld(cargo);
  let origin=ik.controls[2].angle,elbow=ik.controls[1].angle;
  ik.collisions.isWristAboveHeld=()=>true;
  ik.collisions.collision=()=>{
    const turn=ik.controls[2].angle-origin;
    return Math.abs(turn)>.12&&Math.abs(turn)<.22&&Math.abs(ik.controls[1].angle-elbow)<.08?'들어 올린 박스 / hand03 충돌':null;
  };
  const goal={baseYaw:ik.baseControl.angle,angles:ik.controls.map(c=>c.angle),error:0,reachable:true};
  goal.angles[2]+=.4;
  setJointAngle(ik.controls[2],goal.angles[2]);
  const originalTarget=ik.grip.getWorldPosition(new T.Vector3());
  setJointAngle(ik.controls[2],origin);
  if(ik.animate(goal,1)||!ik.lastMotionBlock?.includes('hand03'))throw Error('Blocked motion was not rolled back');
  if(Math.abs(ik.controls[2].angle-origin)>1e-8)throw Error('Collision left an unsafe angle applied');
  function recover(blocked,detourRequired=true){
    const before=[ik.baseControl,...ik.controls].map(c=>c.angle);
    const search=ik.startCollisionRecovery({...blocked,route:undefined,step:undefined},ik.baseControl.angle);
    let result;
    for(;;){
      const next=search.next();
      if([ik.baseControl,...ik.controls].some((c,i)=>Math.abs(c.angle-before[i])>1e-8))throw Error('Recovery planning changed the displayed pose');
      if(next.done){result=next.value;break;}
    }
    const opposite=Math.abs(Math.atan2(Math.sin(result.angles[2]-blocked.angles[2]),Math.cos(result.angles[2]-blocked.angles[2])))>=Math.PI/2;
    if(!result.reachable||(detourRequired&&!result.route&&!opposite))throw Error('Two blocked sweeps did not produce an opposite wrist posture or safe detour');
    if(!opposite&&result.route&&Math.abs(Math.abs(result.route[0].angles[2]-before[3])-T.MathUtils.degToRad(5))>1e-6)throw Error('Escape was not calculated from the current wrist angle');
    return result;
  }
  let pose=recover(goal);
  if(!pose.route&&Math.abs(Math.atan2(Math.sin(pose.angles[2]-goal.angles[2]),Math.cos(pose.angles[2]-goal.angles[2])))<Math.PI/2)throw Error('Recovery kept the same physical wrist posture');
  for(let i=0;i<20;i++)if(!ik.animateEased(pose,1/60))throw Error('Escape crossed the controlled barrier');
  origin=ik.controls[2].angle;elbow=ik.controls[1].angle;
  // Inject a new predicted hit after actual movement. Recovery must start at these newly reached angles.
  const collision=ik.collisions.collision;
  let injected=false;
  ik.collisions.collision=()=>{if(!injected){injected=true;return '들어 올린 박스 / hand03 충돌';}return collision();};
  if(ik.animateEased(pose,1/60))throw Error('Second obstruction was not exercised');
  ik.collisions.collision=collision;
  pose=recover(pose,false);
  for(let i=0;i<5000&&!ik.isEasedSettled(pose);i++){
    if(!ik.animateEased(pose,1/60)||ik.collisions.collision())throw Error('Replanned motion crossed a barrier');
  }
  if(!ik.isEasedSettled(pose)||ik.grip.getWorldPosition(new T.Vector3()).distanceTo(originalTarget)>MOTION.contactTolerance)throw Error('Opposite wrist posture changed the target position');
  console.log('Collision recovery: opposite wrist posture, two-sided blockage, rollback and replanning from newly reached angles passed');
}

const { OnlinePacker }=await import(new URL('../.tmp/ik-tests/onlinePacking.mjs',import.meta.url));
const { ConveyorWorld, createUnitPallet }=await import(new URL('../.tmp/ik-tests/conveyor.mjs',import.meta.url));
const FULL_PALLET_RECIPE=[];
const { BOX_SIZES: PRODUCTION_BOX_SIZES, STREAM_CONFIG }=await import(new URL('../.tmp/ik-tests/constants.mjs',import.meta.url));
// Historical mixed-size fixtures exercise the generic packer independently
// of the production conveyor, which now generates only 3x2x2m boxes.
const BOX_SIZES=[new T.Vector3(2,1,2),new T.Vector3(2,2,2),new T.Vector3(2,1,3),new T.Vector3(2,2,3)];
if(PRODUCTION_BOX_SIZES.length!==1||PRODUCTION_BOX_SIZES[0].distanceTo(new T.Vector3(0.22,0.2,0.275))>1e-8)throw Error('Production box size is not uniformly 0.22x0.2x0.275m');
const {FixedLayerPacker}=await import(new URL('../.tmp/ik-tests/fixedLayerPacking.mjs',import.meta.url));
const ordered=new FixedLayerPacker(new T.Vector3(1.1,5,1.1),PRODUCTION_BOX_SIZES[0],STREAM_CONFIG.center);
const skipped=ordered.candidates(PRODUCTION_BOX_SIZES[0])[1];let skipRejected=false;
try{ordered.commit(skipped);}catch{skipRejected=true;}
if(!skipRejected||ordered.count!==0)throw Error('Fixed layer accepted an out-of-order slot');
let previousDistance=Infinity;
for(let n=0;n<40;n++){
 const placement=ordered.candidates(PRODUCTION_BOX_SIZES[0])[0];
 const position=ordered.position(placement,STREAM_CONFIG.center,0);
 const distance=position.x**2+position.z**2;
 if(n%20===0)previousDistance=Infinity;
 if(distance>previousDistance+1e-8||Math.abs(placement.bottom-Math.floor(n/20)*.2)>1e-8||placement.order!==n+1)throw Error('Fixed layer violated far-first / lower-layer sequence');
 previousDistance=distance;ordered.commit(placement);
}
console.log('Fixed order: twenty slots per layer, far-to-near on every layer, no skipping passed');
const uniformPacking=new OnlinePacker(new T.Vector3(STREAM_CONFIG.palletWidth,STREAM_CONFIG.maxStackHeight,STREAM_CONFIG.palletDepth));
for(let n=0;n<1000;n++){
 const placement=uniformPacking.candidates(PRODUCTION_BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,PRODUCTION_BOX_SIZES)[0];
 if(!placement)break;uniformPacking.commit(placement);
}
if(uniformPacking.count!==500||Math.abs(uniformPacking.volume-6.05)>1e-6||uniformPacking.heights.some(h=>Math.abs(h-5)>1e-6))throw Error('T11 should fit twenty 0.275x0.22m footprints per layer, up to the configured height');
console.log('T11 production: twenty boxes per layer, 55mm grid, no gaps and 0.2m layer heights passed');
const recipeBuilder=new OnlinePacker(new T.Vector3(8,5,8),1);
let layerBottom=0;
for(const height of [1,2,2]){
  let step=0;
  while(recipeBuilder.heights.some(h=>h<layerBottom+height)){
    const big=height===1?2:3,small=height===1?0:1;
    const choices=step%2?[small,big]:[big,small];
    let selected;
    for(const index of choices){const placement=recipeBuilder.candidates(BOX_SIZES[index],STREAM_CONFIG.palletApproachDirection,BOX_SIZES).find(p=>p.bottom===layerBottom);
      if(placement){selected={index,placement};break;}}
    if(!selected||++step>100)throw Error('Known-size layer could not be completed');
    recipeBuilder.commit(selected.placement);FULL_PALLET_RECIPE.push(selected.index);
  }
  layerBottom+=height;
}
const cachedPacking=new OnlinePacker(new T.Vector3(6,5,6),1);
const ranked=cachedPacking.candidates(BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,BOX_SIZES);
const evaluations=cachedPacking.candidateEvaluations;
for(let i=0;i<100;i++)cachedPacking.candidates(BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,BOX_SIZES);
if(cachedPacking.candidateEvaluations!==evaluations)throw Error('Unchanged pallet recomputed packing scores');
cachedPacking.commit(ranked[0]);cachedPacking.candidates(BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,BOX_SIZES);
if(cachedPacking.candidateEvaluations!==evaluations+1)throw Error('Packing cache was not invalidated');
const balancedPacking=new OnlinePacker(new T.Vector3(6,5,6),1);
balancedPacking.commit({x:0,z:0,width:2,depth:2,height:4,bottom:0,yaw:0,revision:0});
if(balancedPacking.candidates(BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,BOX_SIZES)[0].bottom!==0)
  throw Error('Planner grew a tall side before filling lower space');
// Fast descent filter must reject actual cargo/gripper interference without
// mutating the rendered arm, while accepting a distant obstacle.
rollIK.grip.attach(active);active.position.set(0,0,0);
const toolRotation=rollIK.grip.getWorldQuaternion(new T.Quaternion());
const destination=new T.Vector3(0,2,0),placementBlocker=new T.Group();
placementBlocker.userData.collisionRole='pallet';
placementBlocker.add(new T.Mesh(new T.BoxGeometry(.03,.03,.03)));rollWorld.add(placementBlocker);
rollIK.collisions.setContext({boxes:[active,placementBlocker],active,carrying:true});
placementBlocker.position.set(20,20,20);
if(!rollIK.collisions.placementClear(destination,0,3,toolRotation))throw Error('Clear placement rejected');
placementBlocker.position.copy(destination);
if(rollIK.collisions.placementClear(destination,0,3,toolRotation))throw Error('Cargo sweep overlap missed');
const part=wristMesh[0],vertex=new T.Vector3().fromBufferAttribute(part.geometry.attributes.position,0);
part.updateWorldMatrix(true,false);rollIK.grip.updateWorldMatrix(true,false);
const posed=new T.Matrix4().compose(destination,toolRotation,new T.Vector3(1,1,1))
  .multiply(rollIK.grip.matrixWorld.clone().invert()).multiply(part.matrixWorld);
placementBlocker.position.copy(vertex.applyMatrix4(posed));
const unchangedAngles=rollIK.controls.map(c=>c.angle);
// Tool-only interference in one guessed pose must be left to alternate IK poses.
// Actual arm/pallet and held/robot checks below remain mandatory.
if(rollIK.controls.some((c,i)=>c.angle!==unchangedAngles[i]))throw Error('Descent filter moved the robot');

placementBlocker.userData.collisionRole='conveyor';placementBlocker.position.copy(destination);
if(!rollIK.collisions.placementClear(destination,0,3,toolRotation))throw Error('Conveyor box blocked cargo descent');
const overlappingBelt=active.clone(true);overlappingBelt.position.copy(active.getWorldPosition(new T.Vector3()));
overlappingBelt.quaternion.copy(active.getWorldQuaternion(new T.Quaternion()));overlappingBelt.userData.collisionRole='conveyor';rollWorld.add(overlappingBelt);
rollIK.collisions.setContext({boxes:[active,overlappingBelt],active,carrying:true});
if(rollIK.collisions.collision())throw Error(`Held/conveyor overlap was not ignored: ${rollIK.collisions.lastHit}`);
overlappingBelt.userData.collisionRole='placed';
if(!rollIK.collisions.collision())throw Error('Held/placed overlap was disabled');
if(!rollIK.collisions.lastHit.includes('적재된 박스'))throw Error('Placed obstacle mislabeled');
overlappingBelt.userData.collisionRole='pallet';
if(!rollIK.collisions.collision()?.includes('팔레트'))throw Error('Pallet mislabeled as placed box');
// Descent checks must use the attached cargo scale, not a unit cube.
const originalCargoScale=active.scale.clone();active.scale.multiplyScalar(4);
const cargoLocal=new T.Box3().setFromObject(active).getSize(new T.Vector3());
placementBlocker.userData.collisionRole='placed';
placementBlocker.position.copy(destination).add(new T.Vector3(cargoLocal.x*.4,0,0));
rollIK.collisions.setContext({boxes:[active,placementBlocker],active,carrying:true});
if(rollIK.collisions.placementClear(destination,0,3,toolRotation))throw Error('Scaled cargo sweep overlap missed');
active.scale.copy(originalCargoScale);
rollWorld.remove(overlappingBelt);rollWorld.remove(placementBlocker);
const armBox=new T.Group();armBox.add(new T.Mesh(new T.BoxGeometry(.1,.1,.1)));armBox.userData.collisionRole='placed';
armBox.position.copy(new T.Box3().setFromObject(rollModel.getObjectByName('hand04')).getCenter(new T.Vector3()));rollWorld.add(armBox);
rollIK.collisions.setContext({boxes:[armBox],active,carrying:false});
if(rollIK.collisions.collision())throw Error('Arm/box overlap was not ignored');
armBox.userData.collisionRole='pallet';
if(!rollIK.collisions.collision())throw Error('Arm/pallet overlap was disabled');
armBox.userData.collisionRole='held';rollIK.grip.attach(armBox);
rollIK.collisions.setContext({boxes:[armBox],active:armBox,carrying:true});
if(!rollIK.collisions.collision())throw Error('Held cargo/robot overlap was disabled');
const heldBefore=rollIK.controls.map(c=>c.angle);
const blockedHeldPose={angles:[...heldBefore],baseYaw:rollIK.baseControl.angle,error:0,reachable:true};blockedHeldPose.angles[0]+=.01;
if(rollIK.animate(blockedHeldPose,1/60))throw Error('Held cargo/robot collision did not stop motion');
if(rollIK.controls.some((c,i)=>Math.abs(c.angle-heldBefore[i])>1e-8))throw Error('Held cargo/robot collision did not roll back');
rollWorld.attach(armBox);rollWorld.remove(armBox);
rollIK.collisions.setContext({boxes:[],active,carrying:false});
console.log('Collision policy: held/robot detected with rollback; other arm/box and held/conveyor ignored');
console.log('Packing cache, low-layer balance and actual gripper sweep filter passed');
let selection=0;
const randomShapes=new ConveyorWorld(load('box'),load('pallet'),()=>[0,0.3,0.6,0.9][selection++%4]);
for(let n=0;n<100;n++)randomShapes.spawn(0);
if(new Set(randomShapes.items.map(item=>item.size.toArray().join(','))).size!==PRODUCTION_BOX_SIZES.length)
  throw Error('Conveyor generation did not keep the single production size');
const { tile,randomPerfectSet }=await import(new URL('../.tmp/ik-tests/perfectTiling.mjs',import.meta.url));
const inventory=[{w:2,d:3,count:2},{w:2,d:2,count:4},{w:2,d:1,count:4}];
const finiteSolution=tile(6,6,inventory);if(!finiteSolution)throw Error('Finite inventory tiling failed');
const cells=new Set(),used=inventory.map(()=>0);
for(const p of finiteSolution){used[p.type]++;for(let dz=0;dz<p.d;dz++)for(let dx=0;dx<p.w;dx++){
  const key=(p.z+dz)*6+p.x+dx;if(cells.has(key))throw Error('Finite tiling overlap');cells.add(key);
}}
if(cells.size!==36||used.some((n,i)=>n!==inventory[i].count))throw Error('Finite inventory counts changed');
if(tile(6,6,[{w:2,d:2,count:8}])!==null)throw Error('Area mismatch accepted');
const guaranteed=randomPerfectSet(8,8,[[2,2],[2,3]],()=>.3);
if(!guaranteed||!tile(8,8,guaranteed))throw Error('Guaranteed random inventory could not re-tile');
console.log('Inventory exact cover: counts, rotations, area rejection and guaranteed random set passed');
const reachModel=load('robot');reachModel.traverse(n=>{n.position.multiplyScalar(4);if(n.isMesh){n.geometry=n.geometry.clone();n.geometry.scale(4,4,4);}});
const reachRoot=new T.Group();reachRoot.add(reachModel);const reachIK=createRobotIK(reachModel,4);
// This historical 8x8 fixture explicitly exercises the former free-roll mechanism.
// Production uses the locked hand03 contract checked above and in every stream frame.
const historicalRoll = reachIK.controls.find(control => control.node.name === 'hand03');
historicalRoll.locked = false; historicalRoll.min = -Infinity; historicalRoll.max = Infinity;
const farLow=reachIK.plan(new T.Vector3(-9.4,2,0),true),farHigh=reachIK.plan(new T.Vector3(-9.4,6.12,0),true);
if(!farLow.reachable)throw Error(`Far edge reachability regression: ${farLow.blockedBy}`);
if(farHigh.reachable&&farHigh.angles.some((a,i)=>a<reachIK.controls[i].min||a>reachIK.controls[i].max))throw Error('High-hover exceeded joint limits');
if(farLow.angles[0]<reachIK.controls[0].min||farLow.angles[0]>reachIK.controls[0].max)throw Error('Far edge exceeded hand01 limit');
console.log('8x8 far edge reachable with optional tool tilt and expanded joint limits');
const { LayerTiling }=await import(new URL('../.tmp/ik-tests/tiling.mjs',import.meta.url));
const exactLayer=new LayerTiling(6,6),fullMask=(1n<<36n)-1n;
if(exactLayer.canFill(fullMask,[[2,2],[3,2],[2,3]])!==true)throw Error('6x6 exact tiling was rejected');
let oneMetreStrip=0n;for(let z=0;z<6;z++)oneMetreStrip|=1n<<BigInt(z*6);
if(exactLayer.canFill(oneMetreStrip,[[2,2],[3,2],[2,3]])!==false)throw Error('Unfillable 1m strip accepted');
const protectedPacking=new OnlinePacker(new T.Vector3(6,5,6),1);
const initialChoices=protectedPacking.candidates(BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,BOX_SIZES);
if(initialChoices.some(p=>p.x===1&&p.z===1&&p.width===2&&p.depth===2))throw Error('Interior placement destroyed the remaining tiling');
protectedPacking.commit({x:0,z:0,width:2,depth:2,height:1,bottom:0,yaw:0,revision:0});
if(protectedPacking.candidates(BOX_SIZES[2],STREAM_CONFIG.palletApproachDirection,BOX_SIZES).some(p=>p.x===2&&p.z===0&&p.width===3&&p.depth===2&&p.bottom===0))throw Error('2+3 placement left a 1m unusable gap');
console.log('Exact-cover lookahead: complete layer allowed, unfillable slivers rejected');
const recipePacking=new OnlinePacker(new T.Vector3(8,5,8),1);
const farFirst=new OnlinePacker(new T.Vector3(6,5,6),1);
for(let i=0;i<9;i++){
  const placement=farFirst.candidates(new T.Vector3(2,1,2),new T.Vector3(1,0,0),BOX_SIZES)[0];
  if(placement.bottom!==0||placement.x!==Math.floor(i/3)*2)throw Error('Far-side column was not filled before the near side');
  farFirst.commit(placement);
}
if(farFirst.utilization!==1)throw Error('Far-first layer did not fill completely');
const emptyFarFirst=new OnlinePacker(new T.Vector3(6,5,6),1);
for(const size of BOX_SIZES){
  const candidates=emptyFarFirst.candidates(size,STREAM_CONFIG.palletApproachDirection,BOX_SIZES);
  let previous=-Infinity;
  for(const candidate of candidates){
    const nearEdge=candidate.x*emptyFarFirst.cell+candidate.width;
    if(nearEdge<previous)throw Error('Packing/balance scores overrode far-side priority');
    previous=nearEdge;
  }
}
for(const index of FULL_PALLET_RECIPE){
  const placement=recipePacking.candidates(BOX_SIZES[index],STREAM_CONFIG.palletApproachDirection,BOX_SIZES)[0];
  if(!placement)throw Error('8x8 mixed-height production recipe did not fit');
  recipePacking.commit(placement);
}
if(recipePacking.volume!==320||recipePacking.utilization!==1||recipePacking.heights.some(h=>h!==5))
  throw Error('8x8x5 recipe left unused space');
console.log(`Historical 8x8 packing fixture: ${FULL_PALLET_RECIPE.length} mixed-height boxes fill ${recipePacking.volume}m³ without gaps or overhang`);
const remainderPacking=new OnlinePacker(new T.Vector3(8,5,8),1);
let rowX=0;
for(const width of [2,2,3]) {
  remainderPacking.commit({x:rowX,z:0,width,depth:2,height:1,bottom:0,yaw:0,revision:remainderPacking.revision});
  rowX+=width;
}
if(remainderPacking.columns-rowX!==1||remainderPacking.heights[7]!==0)throw Error('2+2+3 row must leave exactly 1 metre');
const heightFixture=new OnlinePacker(new T.Vector3(2,5,2),1);
heightFixture.commit(heightFixture.reserve(new T.Vector3(2,2,2)));
const upper=heightFixture.reserve(new T.Vector3(2,3,2));
if(!upper||upper.bottom+upper.height!==5)throw Error('5m stack rejected');
heightFixture.commit(upper);
if(heightFixture.reserve(new T.Vector3(2,1,2)))throw Error('5m stack height exceeded');
const packing=new OnlinePacker(new T.Vector3(4,3,3),1);
const packed=[];
for(const size of [new T.Vector3(1,1,1),new T.Vector3(2,2,1),new T.Vector3(2,1,1),new T.Vector3(1,1,1),new T.Vector3(2,1,1)]){
  const p=packing.reserve(size);if(!p)throw Error('Mixed packing fixture did not fit');
  const box=new T.Box3(new T.Vector3(p.x*packing.cell,p.bottom,p.z*packing.cell),new T.Vector3(p.x*packing.cell+p.width,p.bottom+p.height,p.z*packing.cell+p.depth)).expandByScalar(-1e-6);
  if(packed.some(other=>box.intersectsBox(other)))throw Error('Mixed boxes overlap');
  packed.push(box);packing.commit(p);
}
if(packing.reserve(new T.Vector3(5,1,1)))throw Error('Oversize box accepted');
console.log('Mixed packing: bounds, support, rotations and non-overlap passed');
const unitPalletBounds=new T.Box3().setFromObject(createUnitPallet(load('pallet')));
if(unitPalletBounds.getSize(new T.Vector3()).distanceTo(new T.Vector3(1,1,1))>1e-5||Math.abs(unitPalletBounds.min.y)>1e-5)
  throw Error('Base pallet must be 1x1x1m with bottom-centred origin');
let randomState=98765;const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
const stream=new ConveyorWorld(load('box'),load('pallet'),random);
const unitBounds=new T.Box3().setFromObject(stream.boxAsset);
if(unitBounds.getSize(new T.Vector3()).distanceTo(new T.Vector3(1,1,1))>1e-5
  ||Math.abs(unitBounds.max.y)>1e-5||Math.abs(unitBounds.getCenter(new T.Vector3()).x)>1e-5
  ||Math.abs(unitBounds.getCenter(new T.Vector3()).z)>1e-5)throw Error('Base box must be 1x1x1m with top-centred origin');
const palletExtent=new T.Box3().setFromObject(stream.pallet).getSize(new T.Vector3());
if(Math.abs(palletExtent.x-STREAM_CONFIG.palletWidth)>1e-5||Math.abs(palletExtent.z-STREAM_CONFIG.palletDepth)>1e-5)
  throw Error('Visual pallet and packing dimensions differ');
for(const item of stream.items){
  if(item.size.distanceTo(PRODUCTION_BOX_SIZES[0])>1e-8)throw Error("Conveyor spawned a non-uniform box");
  if(new T.Box3().setFromObject(item.node).getSize(new T.Vector3()).distanceTo(item.size)>1e-5)
    throw Error('Visual box and packing dimensions differ');
}
// Fill a real load, then exercise outgoing/incoming exchange without robot motion.
const exchangeWorld=new ConveyorWorld(load('box'),load('pallet'),()=>0);
for(let n=0;n<1000;n++){
  const placement=exchangeWorld.packer.candidates(PRODUCTION_BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,PRODUCTION_BOX_SIZES)[0];
  if(!placement)break;
  exchangeWorld.spawn(0);const item=exchangeWorld.items.at(-1);
  exchangeWorld.packer.commit(placement);
  item.node.position.copy(exchangeWorld.packer.position(placement,STREAM_CONFIG.center,exchangeWorld.palletTop));item.state='placed';
}
const oldPallet=exchangeWorld.pallet,loadedItem=exchangeWorld.items.find(item=>item.state==='placed');
const relativeLoad=loadedItem.node.getWorldPosition(new T.Vector3()).sub(oldPallet.getWorldPosition(new T.Vector3()));
exchangeWorld.busy=true;exchangeWorld.advance(1/60);if(exchangeWorld.exchange)throw Error('Pallet changed during an active transfer');
exchangeWorld.busy=false;exchangeWorld.advance(1/60);if(exchangeWorld.exchange!=='outgoing')throw Error('Full pallet was not dispatched');
const beltItem=exchangeWorld.items.find(item=>item.state==='moving'),distanceBefore=beltItem.distance;
for(let i=0;i<60;i++)exchangeWorld.advance(1/60);
const relativeMoved=loadedItem.node.getWorldPosition(new T.Vector3()).sub(oldPallet.getWorldPosition(new T.Vector3()));
if(relativeMoved.distanceTo(relativeLoad)>1e-6||beltItem.distance<=distanceBefore)throw Error('Load did not move with pallet or belt stopped during exchange');
for(let i=0;i<60*12&&exchangeWorld.exchange;i++)exchangeWorld.advance(1/60);
if(exchangeWorld.exchange||exchangeWorld.completedPallets!==1||exchangeWorld.palletNumber!==2||exchangeWorld.packer.count!==0
  ||exchangeWorld.pallet.parent!==exchangeWorld.root||oldPallet.parent||exchangeWorld.items.some(item=>item.state==='departing'))throw Error('New pallet was not reset and prepared');
exchangeWorld.advance(1/60);if(!exchangeWorld.jobs.length)throw Error('Picking did not resume after pallet exchange');
console.log('Pallet exchange: loaded exit, continuous belt, empty reset and next reservation passed');
const rotationWorld=new ConveyorWorld(load('box'),load('pallet'),()=>0);
rotationWorld.advance(1/60);
const rotationJob=rotationWorld.jobs[0];
const initialDiagnostic=rotationWorld.diagnostics;
if(initialDiagnostic.columns!==Math.round(STREAM_CONFIG.palletWidth/PACKING.cell)||initialDiagnostic.rows!==Math.round(STREAM_CONFIG.palletDepth/PACKING.cell)||!initialDiagnostic.selected)throw Error('Packing dashboard grid/candidate not initialized');
rotationJob.onPlanEvent({state:'rejected',phase:'quick',reason:'fixture: far candidate blocked'});
const rejectedDiagnostic=rotationWorld.diagnostics;
fs.writeFileSync('.tmp/packingSnapshot.json',JSON.stringify(rejectedDiagnostic));
if(rejectedDiagnostic.inspected!==1||rejectedDiagnostic.selected.state!=='rejected'||!rejectedDiagnostic.reason.includes('fixture'))throw Error('Packing dashboard did not record actual rejection');
const reservedDestination=rotationJob.destination.clone();
if(rotationJob.replanPlacement()||rotationJob.replanPlacement(true)||rotationJob.advancePlacementLevel()
  ||rotationJob.destination.distanceTo(reservedDestination)>1e-8)throw Error('Fixed production silently skipped its blocked slot');
console.log('Fixed production: blocked placement preserves the same destination and layer');
function makeGapPacking(){
  const packing=new OnlinePacker(new T.Vector3(6,5,6),1);
  for(let x=0;x<6;x++)for(let z=0;z<6;z+=2){
    if(x<2&&z===0)continue;
    packing.commit({x,z,width:1,depth:2,height:1,bottom:0,yaw:Math.PI/2,revision:packing.revision});
  }
  return packing;
}
const gaps=makeGapPacking();
const large=gaps.candidates(BOX_SIZES[3],STREAM_CONFIG.palletApproachDirection,BOX_SIZES)[0];
if(large.bottom!==1)throw Error('Large box must move above the small lower gap');
gaps.commit(large);
const laterSmall=gaps.candidates(BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,BOX_SIZES)[0];
if(laterSmall.bottom!==0||laterSmall.x!==0||laterSmall.z!==0)throw Error('Later small box did not return to the saved lower gap');
const gapWorld=new ConveyorWorld(load('box'),load('pallet'),()=>.9);gapWorld.packer=makeGapPacking();
const smallItem=gapWorld.items[2];smallItem.size.copy(BOX_SIZES[0]);smallItem.node.children[0].scale.copy(smallItem.size);
gapWorld.items[3].size.copy(BOX_SIZES[3]);gapWorld.items[3].node.children[0].scale.copy(BOX_SIZES[3]);
gapWorld.robotZ=2;gapWorld.advance(0);
if(gapWorld.jobs[0].box!==smallItem.node)throw Error('Belt selection did not favour the box that fills the lower gap');
const levelWorld=new ConveyorWorld(load('box'),load('pallet'),()=>0);
levelWorld.packer=new OnlinePacker(new T.Vector3(STREAM_CONFIG.palletWidth,STREAM_CONFIG.maxStackHeight,STREAM_CONFIG.palletDepth));
levelWorld.packer.commit(levelWorld.packer.candidates(PRODUCTION_BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,PRODUCTION_BOX_SIZES)[0]);levelWorld.advance(0);
const levelJob=levelWorld.jobs[0],lowerTop=levelJob.destination.y;
while(levelJob.replanPlacement())if(levelJob.destination.y!==lowerTop)throw Error('Quick search climbed before testing the whole lower level');
if(!levelJob.replanPlacement(true)||levelJob.destination.y!==lowerTop)throw Error('Precise pass did not restart on the lower level');
while(levelJob.replanPlacement())if(levelJob.destination.y!==lowerTop)throw Error('Precise search left the lower level too early');
let raised=false;
for(let n=0;n<100;n++){
  if(!levelJob.advancePlacementLevel())break;
  if(levelJob.destination.y>lowerTop){raised=true;break;}
  while(levelJob.replanPlacement())if(levelJob.destination.y!==lowerTop)throw Error('Access band crossed height during quick search');
  if(!levelJob.replanPlacement(true))throw Error('Precise access band restart failed');
  while(levelJob.replanPlacement())if(levelJob.destination.y!==lowerTop)throw Error('Access band crossed height during precise search');
}
if(!raised)throw Error('Upper level fallback was unavailable after lower-level exhaustion');
console.log('Bottom-first: both search passes stay low, upper fallback preserves holes, and later small boxes fill gaps');

if(process.argv.includes('--packing-only'))process.exit(0);
const obstacles={current:stream.boxes};let streamFrame,streamIK;
const streamFps=Number(process.env.IK_FPS??60);
let lastStatus='';let failures=0;let planningSlices=0,pendingSlices=0,maxPlanningMs=0;
const streamModel=makeRobot(()=>({scene:load('robot',true)}),f=>f(),v=>({current:v}),f=>{streamFrame=f;},T.Group,T.Quaternion,T.Vector3,'',model=>{streamIK=createRobotIK(model,STREAM_CONFIG.robotScale,"held-box-hand03");const originalAdvance=streamIK.advancePlan;streamIK.advancePlan=(...args)=>{
  const before=streamIK.controls.map(c=>c.angle),baseAngle=streamIK.baseControl.angle,position=model.position.clone(),start=performance.now();
  const result=originalAdvance(...args);maxPlanningMs=Math.max(maxPlanningMs,performance.now()-start);planningSlices++;
  if(!result){pendingSlices++;if(Math.abs(streamIK.baseControl.angle-baseAngle)>1e-8||model.position.distanceTo(position)>1e-8||streamIK.controls.some((c,i)=>Math.abs(c.angle-before[i])>1e-8))throw Error('Planning yield left speculative pose visible');}
  if(result&&!result.reachable&&failures++<8)console.log('failed-plan',{tip:streamIK.grip.getWorldPosition(new T.Vector3()).toArray(),angles:streamIK.controls.map(control=>T.MathUtils.radToDeg(control.angle)),blockedBy:result.blockedBy,error:result.error});
  return result;
};return streamIK;},{current:stream.jobs},(_,status)=>{if(lastStatus!==status)console.log('stream',status);lastStatus=status;},{geometryScale:STREAM_CONFIG.robotScale,obstacles});
let injectedRecoveries=0,lastInjectedWrist=null;
if(process.env.IK_INJECT_RECOVERY==='1'){
  const animate=streamIK.animateEased;
  streamIK.animateEased=(...args)=>{
    const controller=controllers.get(streamModel);
    const wrist=streamIK.controls[2].angle;
    if(controller.phase==='TRANSIT'&&injectedRecoveries<2&&(lastInjectedWrist===null||Math.abs(wrist-lastInjectedWrist)>.03)){
      const collision=streamIK.collisions.collision;
      let injected=false;
      streamIK.collisions.collision=()=>{if(!injected){injected=true;return '들어 올린 박스 / hand03 충돌';}return collision();};
      try {
        const moved=animate(...args);
        if(injected&&!moved){injectedRecoveries++;lastInjectedWrist=wrist;}
        return moved;
      } finally {streamIK.collisions.collision=collision;}
    }
    return animate(...args);
  };
}
const streamRoot=new T.Group();streamRoot.add(stream.root,streamModel);
const streamOrigin=streamModel.position.clone();
let minimumBaseYaw=Infinity,maximumBaseYaw=-Infinity;
let maximumMovementWhileReserved=0;
const attachmentPoses=new WeakMap();
const verifiedReleases = new WeakSet();
let releaseCount = 0;
const pickupJointPoses = new WeakMap();
let rearFrames = 0, alignmentFrames = 0, maximumRearShoulder = -Infinity, maximumShoulderTransfer = 0;
const streamController=controllers.get(streamModel);
const phases=new Set();
let verticalFrames=0;
let verticalOrigin=null,verticalPhase=null;
for(let i=0;i<streamFps*Number(process.env.IK_STREAM_SECONDS??400)&&(stream.placed<Number(process.env.IK_STREAM_TARGET??3)||streamController.phase!=="HOME");i++){
  const reserved=stream.items.find(item=>item.state==='reserved');const before=reserved?.node.position.clone();
  stream.advance(1/streamFps);stream.syncJobs();obstacles.current=stream.boxes;
  for (const job of stream.jobs) if (!verifiedReleases.has(job)) {
    verifiedReleases.add(job);
    const onPick = job.onPick;
    job.onPick = () => {
      if(job.box.getWorldPosition(new T.Vector3()).distanceTo(job.pickup)>MOTION.contactTolerance)throw Error("Pickup snapped the cargo");
      pickupJointPoses.set(job.box,{base:streamIK.baseControl.angle,shoulder:streamIK.controls[0].angle});
      onPick?.();
    };
    const onPlace = job.onPlace;
    job.onPlace = () => {
      if(streamController.phase!=="RELEASE")throw Error("Cargo committed outside RELEASE");
      const checkpoint = job.destination;
      if (streamIK.grip.getWorldPosition(new T.Vector3()).distanceTo(checkpoint) > MOTION.contactTolerance) throw Error('Release happened before the robot reached its destination');
      if (job.box.parent === streamIK.grip || job.box.getWorldPosition(new T.Vector3()).distanceTo(job.destination) > 1e-6) throw Error('Checkpoint did not place cargo at the exact destination');
      releaseCount++; onPlace?.();
    };
  }
  if(before&&reserved?.state==='reserved')maximumMovementWhileReserved+=before.distanceTo(reserved.node.position);
  const frameStatus = lastStatus;
  const frameAngles = streamIK.controls.map(control=>control.angle);
  const phaseBefore=streamController.phase;
  const tipBefore=streamIK.grip.getWorldPosition(new T.Vector3());
  if(verticalPhase!==phaseBefore){verticalPhase=phaseBefore;verticalOrigin=tipBefore.clone();}
  streamFrame(null,1/streamFps);
  phases.add(streamController.phase);
  if(["LIFT","PLACE","RETREAT"].includes(phaseBefore)&&phaseBefore===streamController.phase){
    const tipAfter=streamIK.grip.getWorldPosition(new T.Vector3());
    if(Math.hypot(tipAfter.x-verticalOrigin.x,tipAfter.z-verticalOrigin.z)>MOTION.contactTolerance)throw Error("Vertical waypoint drifted horizontally in "+phaseBefore+": "+tipAfter.distanceTo(tipBefore));
    verticalFrames++;
  }
  if (Math.abs(streamIK.controls[3].angle-streamIK.controls[3].initialX)>1e-8) throw Error('Production hand03 rotated');
  const held = stream.items.find(item=>item.state==='held');
  const pickedPose = held && pickupJointPoses.get(held.node);
  if (pickedPose && frameStatus.includes('hand00 고정')) {
    if (Math.abs(streamIK.baseControl.angle-pickedPose.base)>1e-8) throw Error('hand00 rotated before the shoulder finished its rear transfer');
    rearFrames++;
    maximumRearShoulder = Math.max(maximumRearShoulder,streamIK.controls[0].angle);
    maximumShoulderTransfer = Math.max(maximumShoulderTransfer,streamIK.controls[0].angle-pickedPose.shoulder);
  }
  if (held && frameStatus.includes('hand00으로 팔레트 좌우 정렬')) {
    if (streamIK.controls.some((control,index)=>Math.abs(control.angle-frameAngles[index])>1e-8)) throw Error('Pallet alignment changed joints other than hand00');
    alignmentFrames++;
  }
  if (streamIK.collisions.collision()) throw Error('Held box / hand03 collision during animation');
  if (!streamIK.collisions.isWristAboveHeld()) throw Error('hand04 dropped below the lifted box');
  for(const item of stream.items.filter(item=>item.state==='held')){
    if(item.node.parent!==streamIK.grip)continue;
    const saved=attachmentPoses.get(item.node);
    if(!saved)attachmentPoses.set(item.node,{rotation:item.node.quaternion.clone(),position:item.node.position.clone()});
    else if(item.node.quaternion.angleTo(saved.rotation)>1e-6||item.node.position.distanceTo(saved.position)>1e-8)throw Error("Held cargo lost its rigid attachment");
  }
  if(streamModel.position.distanceTo(streamOrigin)>1e-8)throw Error("Robot root translated during conveyor pickup");
  minimumBaseYaw=Math.min(minimumBaseYaw,streamIK.baseControl.angle);maximumBaseYaw=Math.max(maximumBaseYaw,streamIK.baseControl.angle);

  const wristControl=streamIK.controls[2];
  if(!Number.isFinite(wristControl.angle))throw Error('hand04 angle is not finite');
}
console.log({streamPlaced:stream.placed,spawned:stream.spawned,passed:stream.passed,status:lastStatus,movingPickupDistance:maximumMovementWhileReserved,planningSlices,pendingSlices,maxPlanningMs,rearFrames,alignmentFrames,maximumRearShoulderDegrees:T.MathUtils.radToDeg(maximumRearShoulder)});
if(process.env.IK_INJECT_RECOVERY==='1'&&injectedRecoveries!==2)throw Error('Controller did not exercise repeated collision recovery');
if(planningSlices===0)throw Error('No joint targets were calculated');
if(stream.placed<Number(process.env.IK_STREAM_TARGET??3)||maximumMovementWhileReserved<0.01)throw Error('Continuous mixed-size moving pickup fixture failed');
if(stream.items.filter(item=>item.state==='placed').length!==stream.packer.count)throw Error('Pallet committed before placement');
if(releaseCount !== stream.placed)throw Error('Release committed more than once or was skipped');
for(const phase of ['HOME','PRE_GRASP','GRASP','ATTACH','LIFT','SHOULDER_TRANSFER','ALIGN_BASE','TRANSIT','PRE_PLACE','PLACE','RELEASE','RETREAT'])if(!phases.has(phase))throw Error('Missing waypoint phase '+phase);
if(verticalFrames===0||streamController.phase!=='HOME')throw Error('Vertical retreat did not finish');
if(rearFrames===0||alignmentFrames===0||maximumShoulderTransfer<.2)throw Error('Shoulder-first transfer and subsequent base-only alignment were not exercised');
if(maximumBaseYaw-minimumBaseYaw<.1)throw Error('Continuous pickup did not use hand00 yaw');
console.log('Continuous spline: '+stream.placed+' T11 boxes at '+streamFps+'fps; original IK, held-box/hand03 avoidance and yellow-target placement verified');


