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
for (const name of ['joints','collisions','robotIK']) {
  const source = fs.readFileSync(`src/features/${name}.ts`,'utf8').replace('"./joints"','"./joints.mjs"').replace('"./collisions"','"./collisions.mjs"');
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
let robotSource = strip(fs.readFileSync('src/features/Robot.tsx','utf8')).replace('default function Robot','function Robot');
robotSource = robotSource.replace('return <group {...props}><primitive object={model} /></group>;','return model;');
const makeRobot = new Function('useGLTF','useMemo','useRef','useFrame','Group','Quaternion','Vector3','robot','createRobotIK','jobs','report',compile(robotSource)+';return Robot({jobs,running:true,onProgress:report});');
for (const fps of [30,60]) {
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
  const rest3 = model.getObjectByName('hand03').quaternion.clone();
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
    if (ik.collisions.collision()) throw Error(`Collision during animation: ${ik.collisions.lastHit}`);
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
    if (rest3.angleTo(model.getObjectByName('hand03').quaternion)>1e-6) throw Error('hand03 moved');
  }
  const placed = demo.transfers.filter(job=>job.box.getWorldPosition(new T.Vector3()).distanceTo(job.destination)<1e-5).length;
  if (placed!==10 || completed!==10) throw Error(`Only ${placed}/10 placed at ${fps} fps`);
  // A distant goal must fail rather than attach/move to a fabricated pose.
  if (ik.plan(new T.Vector3(100,100,100)).reachable) throw Error('Unreachable goal accepted');
  ik.collisions.setContext({boxes:[],active:demo.transfers[9].box,carrying:false});
  const safePose=ik.plan(ik.grip.getWorldPosition(new T.Vector3()).add(new T.Vector3(0,0.12,0)));
  if(!safePose.reachable) throw Error('Runtime collision fixture has no initial plan');
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





