import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as T from 'three';

// Read actual GLB triangle geometry without decoding textures, preserving
// model transforms and exercising the same BVH collision tests as the app.
function load(name) {
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
    const group = new T.Group(); group.name = node.name;
    if (node.translation) group.position.fromArray(node.translation);
    if (node.rotation) group.quaternion.fromArray(node.rotation);
    if (node.scale) group.scale.fromArray(node.scale);
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
      const geometry=new T.BufferGeometry();
      geometry.setAttribute('position',accessor(primitive.attributes.POSITION));
      if(primitive.indices!==undefined)geometry.setIndex(accessor(primitive.indices));
      const mesh=new T.Mesh(geometry); group.add(mesh);
    }
    return group;
  });
  gltf.nodes.forEach((node, i) => node.children?.forEach(child => nodes[i].add(nodes[child])));
  const root = new T.Group(); gltf.scenes[gltf.scene || 0].nodes.forEach(i => root.add(nodes[i]));
  return root;
}
const output = path.resolve('.tmp/ik-tests'); fs.mkdirSync(output,{recursive:true});
for (const name of ['constants','packingDiagnostics','perfectTiling','tiling','joints','collisions','robotIK','onlinePacking','conveyor']) {
  const source = fs.readFileSync(`src/features/${name}.ts`,'utf8').replaceAll('"./constants"','"./constants.mjs"').replace('"./tiling"','"./tiling.mjs"').replace('"./perfectTiling"','"./perfectTiling.mjs"').replace('"./packingDiagnostics"','"./packingDiagnostics.mjs"').replace('"./joints"','"./joints.mjs"').replace('"./collisions"','"./collisions.mjs"').replace('"./onlinePacking"','"./onlinePacking.mjs"');
  fs.writeFileSync(path.join(output,`${name}.mjs`),ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}));
}
const { createRobotIK } = await import(new URL('../.tmp/ik-tests/robotIK.mjs',import.meta.url));
const strip = source => source.replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
const compile = source => ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
let demoSource = strip(fs.readFileSync('src/features/Canvas.tsx','utf8'));
demoSource = demoSource.slice(0,demoSource.indexOf('default function Canvas'));
demoSource = demoSource.slice(0,demoSource.lastIndexOf('  return ('))+'return demo;}';
const stacking = compile(strip(fs.readFileSync('src/features/stacking.ts','utf8')));
const makeDemo = new Function('useGLTF','useMemo','useRef','useEffect','Box3','Group','Vector3','boxUrl','palletUrl',stacking+compile(demoSource)+';return Demo({running:true,onProgress:()=>{}});');
const { MOTION, IK_CONFIG } = await import(new URL('../.tmp/ik-tests/constants.mjs',import.meta.url));
let robotSource = strip(fs.readFileSync('src/features/Robot.tsx','utf8')).replace('default function Robot','function Robot');
robotSource = robotSource.replace('return <group {...props}><primitive object={model} /></group>;','return model;');
const makeRobot = new Function('useGLTF','useMemo','useRef','useFrame','Group','Quaternion','Vector3','robot','createRobotIK','jobs','report','options',compile(`const MOTION=${JSON.stringify(MOTION)};const IK_CONFIG=${JSON.stringify(IK_CONFIG)};`+robotSource)+';return Robot({jobs,running:true,onProgress:report,...options});');
for (const fps of process.env.IK_STREAM_ONLY?[]:[30,60]) {
  const demo = makeDemo(url=>({scene:load(url)}),f=>f(),v=>({current:v}),()=>{},T.Box3,T.Group,T.Vector3,'box','pallet');
  let frame, ik, completed = 0, minimumGripY = -Infinity, lowering = false;
  const model = makeRobot(()=>({scene:load('gripper_robot')}),f=>f(),v=>({current:v}),f=>{frame=f;},T.Group,T.Quaternion,T.Vector3,'',m=>{
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
  },{current:demo.transfers},count=>{completed=count;});
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
  if (placed!==10 || completed!==10) throw Error(`Only ${placed}/10 placed at ${fps} fps`);
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
  const base=model.getObjectByName('base.009');
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






const { setJointAngle, createJointControl }=await import(new URL('../.tmp/ik-tests/joints.mjs',import.meta.url));
const rollModel=load('gripper_robot'),rollWorld=new T.Group();rollWorld.add(rollModel);
const rollIK=createRobotIK(rollModel),roll=rollIK.controls.find(c=>c.node.name==='hand03');
const active=new T.Group();active.add(new T.Mesh(new T.BoxGeometry(.1,.1,.1).translate(0,-.05,0)));active.position.set(100,100,100);rollWorld.add(active);
rollIK.collisions.setContext({boxes:[],active,carrying:false});
for(const offset of [Math.PI/2,2*Math.PI,-2*Math.PI]) {
  setJointAngle(roll,roll.initialX+offset);
  const expected=roll.rest.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),offset));
  if(roll.node.quaternion.angleTo(expected)>1e-6)throw Error('Blender Z / glTF Y axis mismatch');
}
setJointAngle(roll,roll.initialX);
const rollPose={angles:rollIK.controls.map(c=>c.angle),rail:0,error:0,reachable:true};rollPose.angles[3]+=Math.PI/2;
if(!rollIK.animate(rollPose,10)||Math.abs(roll.angle-rollPose.angles[3])>1e-6)throw Error('hand03 rotation was not animated');
const wristMesh=[];rollModel.getObjectByName('hand04').traverse(n=>{if(n.isMesh)wristMesh.push(n);});
setJointAngle(roll,roll.initialX+Math.PI/4);rollModel.updateWorldMatrix(true,true);
const obstaclePoints=[];
for(const mesh of wristMesh){const positions=mesh.geometry.attributes.position;for(let i=0;i<positions.count;i+=Math.max(1,Math.floor(positions.count/30)))obstaclePoints.push(new T.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld));}
const rollBlocker=new T.Group();rollBlocker.userData.collisionRole='pallet';rollBlocker.add(new T.Mesh(new T.BoxGeometry(.03,.03,.03)));rollWorld.add(rollBlocker);
let sweptCollision=false;
for(const point of obstaclePoints){
  rollBlocker.position.copy(point);setJointAngle(roll,roll.initialX);
  rollIK.collisions.setContext({boxes:[rollBlocker],active,carrying:false});
  if(rollIK.collisions.collision())continue;
  setJointAngle(roll,roll.initialX+Math.PI/2);if(rollIK.collisions.collision())continue;
  setJointAngle(roll,roll.initialX);
  if(!rollIK.animate(rollPose,10)){
    if(Math.abs(roll.angle-roll.initialX)>1e-8)throw Error('hand03 collision rollback failed');
    sweptCollision=true;break;
  }
}
if(!sweptCollision)throw Error('hand03 intermediate rotation collision fixture failed');
for(const name of ['hand02','hand03']){
  const node=new T.Group();node.name=name;const control=createJointControl(node);
  setJointAngle(control,T.MathUtils.degToRad(179));const before=node.quaternion.clone();
  setJointAngle(control,T.MathUtils.degToRad(181));
  if(Math.abs(control.angle-T.MathUtils.degToRad(181))>1e-8||Math.abs(before.angleTo(node.quaternion)-T.MathUtils.degToRad(2))>1e-6)throw Error(name+' full-turn seam clamped');
}
console.log('hand03: Blender local Z axis, full turns, animation and intermediate collision rollback passed');

const { OnlinePacker }=await import(new URL('../.tmp/ik-tests/onlinePacking.mjs',import.meta.url));
const { ConveyorWorld, createUnitPallet }=await import(new URL('../.tmp/ik-tests/conveyor.mjs',import.meta.url));
const FULL_PALLET_RECIPE=[];
const { BOX_SIZES, STREAM_CONFIG }=await import(new URL('../.tmp/ik-tests/constants.mjs',import.meta.url));
const recipeBuilder=new OnlinePacker(new T.Vector3(STREAM_CONFIG.palletWidth,STREAM_CONFIG.maxStackHeight,STREAM_CONFIG.palletDepth));
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
const cachedPacking=new OnlinePacker(new T.Vector3(6,5,6));
const ranked=cachedPacking.candidates(BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,BOX_SIZES);
const evaluations=cachedPacking.candidateEvaluations;
for(let i=0;i<100;i++)cachedPacking.candidates(BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,BOX_SIZES);
if(cachedPacking.candidateEvaluations!==evaluations)throw Error('Unchanged pallet recomputed packing scores');
cachedPacking.commit(ranked[0]);cachedPacking.candidates(BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,BOX_SIZES);
if(cachedPacking.candidateEvaluations!==evaluations+1)throw Error('Packing cache was not invalidated');
const balancedPacking=new OnlinePacker(new T.Vector3(6,5,6));
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
const blockedHeldPose={angles:[...heldBefore],rail:0,error:0,reachable:true};blockedHeldPose.angles[0]+=.01;
if(rollIK.animate(blockedHeldPose,1/60))throw Error('Held cargo/robot collision did not stop motion');
if(rollIK.controls.some((c,i)=>Math.abs(c.angle-heldBefore[i])>1e-8))throw Error('Held cargo/robot collision did not roll back');
rollWorld.attach(armBox);rollWorld.remove(armBox);
rollIK.collisions.setContext({boxes:[],active,carrying:false});
console.log('Collision policy: held/robot detected with rollback; other arm/box and held/conveyor ignored');
console.log('Packing cache, low-layer balance and actual gripper sweep filter passed');
let selection=0;
const randomShapes=new ConveyorWorld(load('box'),load('pallet'),()=>[0,0.3,0.6,0.9][selection++%4]);
for(let n=0;n<100;n++)randomShapes.spawn(0);
if(new Set(randomShapes.items.map(item=>item.size.toArray().join(','))).size!==BOX_SIZES.length)
  throw Error('Random generation cannot select all box height variants');
const { tile,randomPerfectSet }=await import(new URL('../.tmp/ik-tests/perfectTiling.mjs',import.meta.url));
const inventory=[{w:2,d:3,count:2},{w:2,d:2,count:4},{w:2,d:1,count:4}];
const finiteSolution=tile(6,6,inventory);if(!finiteSolution)throw Error('Finite inventory tiling failed');
const cells=new Set(),used=inventory.map(()=>0);
for(const p of finiteSolution){used[p.type]++;for(let dz=0;dz<p.d;dz++)for(let dx=0;dx<p.w;dx++){
  const key=(p.z+dz)*6+p.x+dx;if(cells.has(key))throw Error('Finite tiling overlap');cells.add(key);
}}
if(cells.size!==36||used.some((n,i)=>n!==inventory[i].count))throw Error('Finite inventory counts changed');
if(tile(6,6,[{w:2,d:2,count:8}])!==null)throw Error('Area mismatch accepted');
const guaranteed=randomPerfectSet(STREAM_CONFIG.palletWidth,STREAM_CONFIG.palletDepth,[[2,2],[2,3]],()=>.3);
if(!guaranteed||!tile(STREAM_CONFIG.palletWidth,STREAM_CONFIG.palletDepth,guaranteed))throw Error('Guaranteed random inventory could not re-tile');
console.log('Inventory exact cover: counts, rotations, area rejection and guaranteed random set passed');
const reachModel=load('gripper_robot');reachModel.traverse(n=>{n.position.multiplyScalar(4);if(n.isMesh){n.geometry=n.geometry.clone();n.geometry.scale(4,4,4);}});
const reachRoot=new T.Group();reachRoot.add(reachModel);const reachIK=createRobotIK(reachModel,4);
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
const protectedPacking=new OnlinePacker(new T.Vector3(6,5,6));
const initialChoices=protectedPacking.candidates(BOX_SIZES[0],STREAM_CONFIG.palletApproachDirection,BOX_SIZES);
if(initialChoices.some(p=>p.x===1&&p.z===1&&p.width===2&&p.depth===2))throw Error('Interior placement destroyed the remaining tiling');
protectedPacking.commit({x:0,z:0,width:2,depth:2,height:1,bottom:0,yaw:0,revision:0});
if(protectedPacking.candidates(BOX_SIZES[2],STREAM_CONFIG.palletApproachDirection,BOX_SIZES).some(p=>p.x===2&&p.z===0&&p.width===3&&p.depth===2&&p.bottom===0))throw Error('2+3 placement left a 1m unusable gap');
console.log('Exact-cover lookahead: complete layer allowed, unfillable slivers rejected');
const recipePacking=new OnlinePacker(new T.Vector3(STREAM_CONFIG.palletWidth,STREAM_CONFIG.maxStackHeight,STREAM_CONFIG.palletDepth));
const farFirst=new OnlinePacker(new T.Vector3(6,5,6));
for(let i=0;i<9;i++){
  const placement=farFirst.candidates(new T.Vector3(2,1,2),new T.Vector3(1,0,0),BOX_SIZES)[0];
  if(placement.bottom!==0||placement.x!==Math.floor(i/3)*2)throw Error('Far-side column was not filled before the near side');
  farFirst.commit(placement);
}
if(farFirst.utilization!==1)throw Error('Far-first layer did not fill completely');
const emptyFarFirst=new OnlinePacker(new T.Vector3(6,5,6));
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
if(recipePacking.volume!==STREAM_CONFIG.palletWidth*STREAM_CONFIG.palletDepth*STREAM_CONFIG.maxStackHeight||recipePacking.utilization!==1||recipePacking.heights.some(h=>h!==5))
  throw Error('8x8x5 recipe left unused space');
console.log(`${STREAM_CONFIG.palletWidth}x${STREAM_CONFIG.palletDepth} pallet: ${FULL_PALLET_RECIPE.length} mixed-height boxes fill ${recipePacking.volume}m³ without gaps or overhang`);
const remainderPacking=new OnlinePacker(new T.Vector3(8,5,8));
let rowX=0;
for(const width of [2,2,3]) {
  remainderPacking.commit({x:rowX,z:0,width,depth:2,height:1,bottom:0,yaw:0,revision:remainderPacking.revision});
  rowX+=width;
}
if(remainderPacking.columns-rowX!==1||remainderPacking.heights[7]!==0)throw Error('2+2+3 row must leave exactly 1 metre');
const heightFixture=new OnlinePacker(new T.Vector3(2,5,2));
heightFixture.commit(heightFixture.reserve(new T.Vector3(2,2,2)));
const upper=heightFixture.reserve(new T.Vector3(2,3,2));
if(!upper||upper.bottom+upper.height!==5)throw Error('5m stack rejected');
heightFixture.commit(upper);
if(heightFixture.reserve(new T.Vector3(2,1,2)))throw Error('5m stack height exceeded');
const packing=new OnlinePacker(new T.Vector3(4,3,3));
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
  if(new T.Box3().setFromObject(item.node).getSize(new T.Vector3()).distanceTo(item.size)>1e-5)
    throw Error('Visual box and packing dimensions differ');
}
// Fill a real load, then exercise outgoing/incoming exchange without robot motion.
const exchangeWorld=new ConveyorWorld(load('box'),load('pallet'),()=>0);
for(const index of FULL_PALLET_RECIPE){
  exchangeWorld.spawn(0);const item=exchangeWorld.items.at(-1);item.size.copy(BOX_SIZES[index]);item.node.children[0].scale.copy(item.size);
  const placement=exchangeWorld.packer.candidates(item.size,STREAM_CONFIG.palletApproachDirection,BOX_SIZES)[0];exchangeWorld.packer.commit(placement);
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
const rotationJob=rotationWorld.jobs[0],yawOptions=new Set([rotationJob.yaw]);
const initialDiagnostic=rotationWorld.diagnostics;
if(initialDiagnostic.columns!==STREAM_CONFIG.palletWidth||initialDiagnostic.rows!==STREAM_CONFIG.palletDepth||!initialDiagnostic.selected)throw Error('Packing dashboard grid/candidate not initialized');
rotationJob.onPlanEvent({state:'rejected',phase:'quick',reason:'fixture: far candidate blocked'});
const rejectedDiagnostic=rotationWorld.diagnostics;
fs.writeFileSync('.tmp/packingSnapshot.json',JSON.stringify(rejectedDiagnostic));
if(rejectedDiagnostic.inspected!==1||rejectedDiagnostic.selected.state!=='rejected'||!rejectedDiagnostic.reason.includes('fixture'))throw Error('Packing dashboard did not record actual rejection');
let retryCount=0;
do {
  yawOptions.add(rotationJob.yaw);
  while(rotationJob.replanPlacement()){
    yawOptions.add(rotationJob.yaw);
    if(++retryCount>1000)throw Error('Placement retries did not terminate');
  }
} while(rotationJob.advancePlacementLevel());
if(retryCount<1)throw Error('Rotated packing candidates were skipped');
console.log('Placement fallback: both orientations and all supported cells examined');
function makeGapPacking(){
  const packing=new OnlinePacker(new T.Vector3(6,5,6));
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
for(const item of levelWorld.items){item.size.copy(BOX_SIZES[0]);item.node.children[0].scale.copy(item.size);}
levelWorld.packer.commit({x:0,z:0,width:2,depth:2,height:1,bottom:0,yaw:0,revision:0});levelWorld.advance(0);
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
let lastStatus='';let failures=0;let planningSlices=0,pendingSlices=0,maxPlanningMs=0;
const streamModel=makeRobot(()=>({scene:load('gripper_robot')}),f=>f(),v=>({current:v}),f=>{streamFrame=f;},T.Group,T.Quaternion,T.Vector3,'',model=>{streamIK=createRobotIK(model,4);const originalAdvance=streamIK.advancePlan;streamIK.advancePlan=(...args)=>{
  const before=streamIK.controls.map(c=>c.angle),position=model.position.clone(),start=performance.now();
  const result=originalAdvance(...args);maxPlanningMs=Math.max(maxPlanningMs,performance.now()-start);planningSlices++;
  if(!result){pendingSlices++;if(model.position.distanceTo(position)>1e-8||streamIK.controls.some((c,i)=>Math.abs(c.angle-before[i])>1e-8))throw Error('Planning yield left speculative pose visible');}
  if(result&&!result.reachable&&failures++<8)console.log('failed-plan',{tip:streamIK.grip.getWorldPosition(new T.Vector3()).toArray(),hit:streamIK.collisions.lastHit,error:result.error});
  return result;
};const originalPlan=streamIK.plan;streamIK.plan=(...args)=>{const pose=originalPlan(...args);if(!pose.reachable&&failures++<5)console.log("moving failed",args[0].toArray(),pose,streamIK.collisions.lastHit);return pose;};return streamIK;},{current:stream.jobs},(_,status)=>{if(lastStatus!==status)console.log('stream',status);lastStatus=status;},{geometryScale:4,obstacles});
const streamRoot=new T.Group();streamRoot.add(stream.root,streamModel);
let maximumMovementWhileReserved=0;
for(let i=0;i<60*Number(process.env.IK_STREAM_SECONDS??100)&&stream.placed<Number(process.env.IK_STREAM_TARGET??3);i++){
  const reserved=stream.items.find(item=>item.state==='reserved');const before=reserved?.node.position.clone();
  stream.advance(1/60);stream.syncJobs();obstacles.current=stream.boxes;
  if(before&&reserved?.state==='reserved')maximumMovementWhileReserved+=before.distanceTo(reserved.node.position);
  streamFrame(null,1/60);
  const wristControl=streamIK.controls[2];
  if(wristControl.angle<T.MathUtils.degToRad(-330)-1e-8||wristControl.angle>T.MathUtils.degToRad(-30)+1e-8)throw Error('hand04 frame exceeded negative-angle limits');
}
console.log({streamPlaced:stream.placed,spawned:stream.spawned,passed:stream.passed,status:lastStatus,movingPickupDistance:maximumMovementWhileReserved,planningSlices,pendingSlices,maxPlanningMs});
if(pendingSlices===0)throw Error('Planning was not spread across frames');
if(stream.placed<Number(process.env.IK_STREAM_TARGET??3)||maximumMovementWhileReserved<0.01)throw Error('Continuous mixed-size moving pickup fixture failed');
if(stream.items.filter(item=>item.state==='placed').length!==stream.packer.count)throw Error('Pallet committed before placement');
console.log('Continuous spline: three metre-sized shapes picked while moving and committed after placement');


