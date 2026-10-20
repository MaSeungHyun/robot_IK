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
  sceneTemplates:'src/constants/sceneTemplates.ts',
  applySceneTemplate:'src/features/simulator/templates/applySceneTemplate.ts',
  useHudStore:'src/stores/useHudStore.ts',
  useModeStore:'src/stores/useModeStore.ts',
  applyEquipmentSettings:'src/utils/equipment/applyEquipmentSettings.ts',
  telemetry:'src/constants/telemetry.ts',
  equipmentTelemetry:'src/mock/equipmentTelemetry.ts',
  playback:'src/constants/playback.ts',
  simulationTime:'src/utils/simulation/simulationTime.ts',
  SceneInstances:'src/features/Viewport/instancing/SceneInstances.ts',
  SelectionOutline:'src/features/Viewport/instancing/SelectionOutline.ts',
  conveyorTemplate:'src/features/conveyor/conveyorTemplate.ts',
  conveyorLayout:'src/utils/conveyor/conveyorLayout.ts',
  conveyorLayoutConfig:'src/constants/conveyorLayoutConfig.ts',
  useSceneStore:'src/stores/useSceneStore.ts',
  useSimulationStore:'src/stores/useSimulationStore.ts',
  sceneValidation:'src/utils/amr/sceneValidation.ts',
  scanner: "src/constants/scanner.ts",
  scannerModel: "src/utils/scanner/scannerModel.ts",
  ScannerInspection: "src/features/scanner/ScannerInspection.ts",
  simulatorLayout:'src/constants/simulatorLayout.ts',
  pathfinding:'src/utils/amr/pathfinding.ts',
  layoutNavigation:'src/utils/amr/layoutNavigation.ts',
  PalletDispatchController:'src/features/amr/PalletDispatchController.ts',
  AMRTrafficController:'src/features/amr/AMRTrafficController.ts',
  FactorySimulator:'src/features/simulator/runtime/FactorySimulator.ts',
  PalletController:'src/features/Viewport/models/Pallet/PalletController.ts',
  palletModel:'src/features/Viewport/models/Pallet/palletModel.ts',
  stacking:'src/utils/packing/stacking.ts',
  constants: 'src/constants/simulation.ts',
  ConveyorSimulator: 'src/legacy/conveyor/ConveyorSimulator.ts',
  modelNormalization:'src/utils/three/modelNormalization.ts',
  ...Object.fromEntries(['joints','collisions','robotKinematics','closedChainKinematics','robotIK','heldBoxCollision','picking','motionTiming'].map(name => [name, `src/utils/robot/${name}.ts`])),
  ...Object.fromEntries(['packingDiagnostics','perfectTiling','tiling','onlinePacking','fixedLayerPacking'].map(name => [name, `src/utils/packing/${name}.ts`])),
};
for (const name of Object.keys(sourcePaths)) {
  const source = fs.readFileSync(sourcePaths[name], "utf8").replace(/from "(?:@\/|(?:\.\.?\/)+)[^"\n]+"/g, spec => spec.replace(/"[^"\n]+"/, value => {const base=path.basename(value.slice(1,-1));return `"./${base==="simulation"?"constants":base}.mjs"`;}));
  fs.writeFileSync(path.join(output,`${name}.mjs`),ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}));
}
if(process.argv.includes('--templates')) {
  const {SCENE_TEMPLATES:templates}=await import('../.tmp/ik-tests/sceneTemplates.mjs');
  const {applySceneTemplate:apply}=await import('../.tmp/ik-tests/applySceneTemplate.mjs');
  const {useSceneStore:scene}=await import('../.tmp/ik-tests/useSceneStore.mjs');
  const {useModeStore:mode}=await import('../.tmp/ik-tests/useModeStore.mjs');
  const {useSimulationStore:simulation}=await import('../.tmp/ik-tests/useSimulationStore.mjs');
  const {useHudStore:hud}=await import('../.tmp/ik-tests/useHudStore.mjs');
  const {FactorySimulator}=await import('../.tmp/ik-tests/FactorySimulator.mjs');
  const {beltConnections}=await import('../.tmp/ik-tests/conveyorLayout.mjs');
  mode.getState().setMode('simulation');
  scene.getState().clear();
  scene.getState().add('robot',{x:9,z:9,yaw:0});
  const previous=scene.getState().objects;
  if(!apply(templates[0])||scene.getState().objects.length!==3)throw Error('Template did not replace scene');
  scene.getState().undo();
  if(scene.getState().objects!==previous)throw Error('Template replacement was not atomic undo');
  scene.getState().redo();
  if(scene.getState().objects.length!==3)throw Error('Template redo failed');
  const unchanged=scene.getState().objects;
  if(apply({...templates[0],equipment:[{kind:'robot',x:NaN,z:0,yaw:0}]})||scene.getState().objects!==unchanged)throw Error('Invalid template replaced scene');
  mode.getState().setMode('monitoring');
  if(apply(templates[0]))throw Error('Monitoring accepted a template');
  mode.getState().setMode('simulation');
  for(const template of templates){
    if(!apply(template))throw Error(`Could not load ${template.id}`);
    const state=scene.getState();
    if(new Set(state.objects.map(o=>o.id)).size!==state.objects.length)throw Error('Duplicate equipment IDs');
    const world=new FactorySimulator(state.objects,load('box'),load('pallet'),()=>scene.getState().settings);
    for(let i=0;i<1800;i++)world.advance(1/30);
    if(!world.robots.some(robot=>robot.jobs.length))throw Error(`No reachable robot job in ${template.id}`);
    if(template.id==='inspection-line'&&beltConnections(state.objects).next.size!==2)throw Error('Template conveyors are disconnected');
    world.dispose();
  }
  if(!apply(templates[0],true)||scene.getState().editing||!simulation.getState().running)throw Error('Run template did not start Play');
  const run=simulation.getState().run;
  hud.getState().closeWorkspacePanel();
  if(!simulation.getState().running||simulation.getState().run!==run)throw Error('Closing Play stopped template');
  if(apply(templates[1]))throw Error('Live scene was replaced outside Edit');
  console.log('Templates: all layouts generate robot jobs; connected inspection line; atomic undo/redo; validation; mode guards; direct Play and independent panels passed');
  process.exit(0);
}
if(process.argv.includes('--telemetry')) {
  const assert = (await import('node:assert/strict')).default;
  const {createMockTelemetry} = await import('../.tmp/ik-tests/equipmentTelemetry.mjs');
  const {useSimulationStore: store} = await import('../.tmp/ik-tests/useSimulationStore.mjs');
  const objects = [{id:'a',kind:'robot'}, {id:'b',kind:'robot'}];
  const settings = {a:{enabled:true},b:{enabled:true}};
  let values = createMockTelemetry(objects,settings,{},()=>0.5);
  const program = values.a.program;
  const count = values.a.operationCount;
  for(let i=0;i<1000;i++) values = createMockTelemetry(objects,settings,values,()=>0.99);
  assert.ok(values.a.motorTemperatureC <= 65);
  assert.ok(values.a.controllerTemperatureC <= 58);
  assert.ok(values.a.powerKw <= 4.5);
  assert.equal(values.a.program,program);
  assert.equal(values.a.operationCount,count+1000);
  const frozen = createMockTelemetry(objects,{...settings,a:{enabled:false}},values,()=>0);
  assert.equal(frozen.a,values.a);
  assert.deepEqual(Object.keys(createMockTelemetry([objects[0]],settings,values)),['a']);
  const joint = {name:'hand00',axis:'X',degrees:12,locked:false,min:-180,max:180};
  store.getState().setRobotJointAngles('a',[joint]);
  store.getState().setRobotJointAngles('b',[{...joint,degrees:35}]);
  const before = store.getState();
  store.getState().setRobotJointAngles('a',[{...joint}]);
  assert.equal(store.getState(),before);
  assert.equal(store.getState().robotJointAngles.b[0].degrees,35);
  store.getState().removeRobotJointAngles('a');
  assert.equal(store.getState().robotJointAngles.a,undefined);
  assert.equal(store.getState().robotJointAngles.b[0].degrees,35);
  store.getState().setMockTelemetry(values);
  store.getState().reset();
  assert.deepEqual(store.getState().robotJointAngles,{});
  assert.deepEqual(store.getState().mockTelemetry,{});
  console.log('Telemetry: bounded drift, stable program, disabled freeze, removal, per-robot isolation, unchanged-sample deduplication and reset passed');
  process.exit(0);
}
if(process.argv.includes('--partial-layout')) {
  const assert = (await import('node:assert/strict')).default;
  const {FactorySimulator} = await import('../.tmp/ik-tests/FactorySimulator.mjs');
  const {validateScene} = await import('../.tmp/ik-tests/sceneValidation.mjs');
  const {useSceneStore: scene} = await import('../.tmp/ik-tests/useSceneStore.mjs');
  const {DEFAULT_LAYOUT} = await import('../.tmp/ik-tests/simulatorLayout.mjs');
  const kinds = ['robot','pallet','conveyor','amr','dock','scanner'];
  const assets = {box:load('box'),pallet:load('pallet')};
  const defaults = {speed:1,reach:1.8,capacity:20,spawnInterval:8,enabled:true};

  for(let mask=0;mask<1<<kinds.length;mask++) {
    scene.getState().clear();
    for(let i=0;i<kinds.length;i++) {
      if(mask & 1<<i) scene.getState().add(kinds[i],DEFAULT_LAYOUT[kinds[i]]);
    }
    scene.getState().complete();
    const state=scene.getState();
    assert.equal(state.editing,false,`Partial layout ${mask} blocked completion`);
    assert.deepEqual(state.errors,[]);
    const world=new FactorySimulator(state.objects,assets.box,assets.pallet,()=>state.settings);
    for(let step=0;step<10;step++) world.advance(.25);
    assert.ok(world.elapsed>0);
    assert.equal(world.equipment.robots.length,mask&1?1:0);
    if(!state.objects.some(o=>o.kind==='conveyor')) assert.equal(world.spawned,0);
    world.dispose();
  }

  const robot={id:'robot',kind:'robot',name:'robot',x:100,z:100,yaw:0};
  const pallet={id:'pallet',kind:'pallet',name:'pallet',x:-100,z:-100,yaw:0};
  assert.deepEqual(validateScene([robot,pallet],{robot:defaults,pallet:defaults}),[]);
  assert.ok(validateScene([{...robot,x:NaN}],{robot:defaults}).length);
  assert.ok(validateScene([robot],{}).length);
  assert.ok(validateScene([robot],{robot:{...defaults,speed:0}}).length);
  assert.ok(validateScene([robot],{robot:{...defaults,defectRate:1.1}}).length);
  console.log('Partial layouts: empty scene and all 64 equipment combinations complete and advance; independent conveyors run; missing dependencies and unreachable equipment do not block; invalid values still rejected');
  process.exit(0);
}
if(process.argv.includes('--scanner')) {
  const assert = (await import('node:assert/strict')).default;
  const {ScannerInspection} = await import('../.tmp/ik-tests/ScannerInspection.mjs');
  const {createScannerModel} = await import('../.tmp/ik-tests/scannerModel.mjs');
  const {FactorySimulator} = await import('../.tmp/ik-tests/FactorySimulator.mjs');
  let time = 0;
  const config = {speed:1,enabled:true,defectRate:0,spawnInterval:1000,reach:1.8,capacity:20};
  const settings = {scanner:{...config},second:{...config}};
  const inspection = new ScannerInspection(()=>settings,()=>.5,()=>time);
  const sensor = {point:new T.Vector3(0,.7,0),normal:new T.Vector3(0,0,1),halfWidth:.3,floor:0};
  inspection.register('scanner',sensor);
  const box = new T.Group(), from=new T.Vector3(0,.45,-2), to=new T.Vector3(0,.45,2);
  inspection.inspectMovement(box,from,to);
  assert.equal(inspection.getSignal('scanner'),'safe');
  inspection.inspectMovement(box,to,from);
  assert.equal(inspection.snapshots[0].scanned,1);
  time=.999;assert.equal(inspection.getSignal('scanner'),'safe');
  time=1;assert.equal(inspection.getSignal('scanner'),null);
  settings.scanner.defectRate=1;
  const faulty=new T.Group();inspection.inspectMovement(faulty,from,to);
  assert.equal(inspection.getSignal('scanner'),'fault');
  assert.equal(inspection.snapshots[0].faults,1);
  inspection.register('second',sensor);
  inspection.inspectMovement(box,from,to);
  assert.equal(inspection.getSignal('second'),'safe');
  settings.scanner.enabled=false;
  inspection.inspectMovement(new T.Group(),from,to);
  assert.equal(inspection.snapshots[0].scanned,2);
  settings.scanner.enabled=true;
  inspection.inspectMovement(new T.Group(),new T.Vector3(1,.45,-2),new T.Vector3(1,.45,2));
  inspection.inspectMovement(new T.Group(),new T.Vector3(0,1,-2),new T.Vector3(0,1,2));
  assert.equal(inspection.snapshots[0].scanned,2);
  settings.rotated={...config};
  inspection.register('rotated',{...sensor,point:new T.Vector3(4,.7,5),normal:new T.Vector3(1,0,0)});
  inspection.inspectMovement(new T.Group(),new T.Vector3(2,.45,5),new T.Vector3(6,.45,5));
  assert.equal(inspection.getSignal('rotated'),'safe');

  const asset=load('scanner');
  const raw=fs.readFileSync('src/assets/models/scanner.glb');
  const metadata=JSON.parse(raw.subarray(20,20+raw.readUInt32LE(12)).toString());
  let index=0;
  asset.traverse(node=>{if(node instanceof T.Mesh){node.material=new T.MeshStandardMaterial({name:metadata.materials[index++].name});}});
  const first=createScannerModel(asset),second=createScannerModel(asset);
  assert.ok(first.localPoint.y>.45&&first.halfWidth>.175);
  const signalMaterial=(model)=>{let material;model.traverse(node=>{if(node instanceof T.Mesh){const list=Array.isArray(node.material)?node.material:[node.material];material??=list.find(m=>m.name==='gradient');}});return material;};
  const original=signalMaterial(first.model).color.clone();
  const colors={safe:'#19de86',fault:'#f94258'};
  first.setSignal('fault',colors);
  assert.equal(signalMaterial(first.model).color.getHexString(),'f94258');
  assert.ok(signalMaterial(second.model).color.equals(original));
  first.setSignal(null,colors);
  assert.ok(signalMaterial(first.model).color.equals(original));
  first.dispose();second.dispose();

  const objects=[{id:'belt',kind:'conveyor',name:'belt',x:0,z:0,yaw:0}];
  const world=new FactorySimulator(objects,load('box'),load('pallet'),()=>({belt:config,scanner:config}));
  world.inspection.register('scanner',sensor);
  world.advance(30);
  assert.ok(world.inspection.snapshots[0].scanned>=3,'High-speed travel missed the scan plane');
  assert.equal(world.inspection.snapshots[0].lastResult,'safe');
  world.dispose();inspection.dispose();
  assert.equal(inspection.active,false);
  console.log('Scanner: actual GLB ScanPoint/material, isolated colors and restoration, 0/100% defects, stable per-box result, deduplication, disabled/off-aperture exclusion, real-time one-second signal and fast conveyor crossings passed');
  process.exit(0);
}
if(process.argv.includes('--hud-workspace')){
  const {useHudStore:hud}=await import('../.tmp/ik-tests/useHudStore.mjs');
  const {useSceneStore:scene}=await import('../.tmp/ik-tests/useSceneStore.mjs');
  const {useSimulationStore:simulation}=await import('../.tmp/ik-tests/useSimulationStore.mjs');
  const {useModeStore:mode}=await import('../.tmp/ik-tests/useModeStore.mjs');
  mode.getState().setMode('simulation');
  scene.getState().example();
  const initialRun=simulation.getState().run;
  hud.getState().closeWorkspacePanel();
  if(!scene.getState().editing||simulation.getState().run!==initialRun)throw Error('Closing Edit changed workspace');
  hud.getState().selectWorkspaceMode('edit');
  if(!hud.getState().workspacePanelOpen||!scene.getState().editing)throw Error('Edit panel did not reopen');
  const id=scene.getState().objects[0].id;
  scene.getState().updateSettings(id,{speed:0});
  hud.getState().selectWorkspaceMode('play');
  if(!scene.getState().editing||!scene.getState().errors.length)throw Error('Invalid layout entered Play');
  scene.getState().updateSettings(id,{speed:1});
  hud.getState().selectWorkspaceMode('play');
  if(scene.getState().editing||hud.getState().inspectorTab!=='equipments')throw Error('Play transition failed');
  simulation.getState().setRunning(true);
  const run=simulation.getState().run;
  const assertPlayback=()=>{if(scene.getState().editing||!simulation.getState().running||simulation.getState().run!==run)throw Error('Panel interaction changed playback');};
  hud.getState().closeWorkspacePanel();assertPlayback();
  hud.getState().toggleInspectorTab('details');assertPlayback();
  if(hud.getState().inspectorTab!=='details')throw Error('Inspector selection failed');
  hud.getState().toggleInspectorTab('details');assertPlayback();
  if(hud.getState().inspectorTab!==null)throw Error('Inspector close failed');
  hud.getState().selectWorkspaceMode('play');assertPlayback();
  mode.getState().setMode('monitoring');
  hud.getState().selectWorkspaceMode('edit');assertPlayback();
  hud.getState().toggleInspectorTab('dashboard');assertPlayback();
  mode.getState().setMode('simulation');
  hud.getState().selectWorkspaceMode('edit');
  if(!scene.getState().editing||simulation.getState().running)throw Error('Edit transition did not stop simulation');
  console.log('HUD: Edit/Play transitions, validation, independent panel visibility, uninterrupted playback and monitoring guards passed');
  process.exit(0);
}
if(process.argv.includes('--equipment-settings')){
  const {useModeStore:mode}=await import('../.tmp/ik-tests/useModeStore.mjs');
  const {useSceneStore:scene}=await import('../.tmp/ik-tests/useSceneStore.mjs');
  const {useSimulationStore:simulation}=await import('../.tmp/ik-tests/useSimulationStore.mjs');
  const {applyEquipmentSettings:apply}=await import('../.tmp/ik-tests/applyEquipmentSettings.mjs');
  scene.getState().example();
  const id=scene.getState().objects.find(object=>object.kind==='robot').id;
  simulation.setState({running:true});
  const run=simulation.getState().run;
  mode.getState().setMode('simulation');
  if(!apply(id,{speed:2})||scene.getState().settings[id].speed!==2)throw Error('Simulation settings were not applied');
  if(simulation.getState().run!==run||!simulation.getState().running)throw Error('Settings reset playback');
  mode.getState().setMode('monitoring');
  if(apply(id,{speed:3})||scene.getState().settings[id].speed!==2)throw Error('Monitoring settings were writable');
  mode.getState().setMode('simulation');
  if(apply('missing',{speed:2}))throw Error('Missing equipment accepted a command');
  console.log('Equipment settings: simulation updates, uninterrupted playback, read-only monitoring and missing equipment passed');
  process.exit(0);
}
if(process.argv.includes('--editor-history')){
  const {useSceneStore:scene}=await import('../.tmp/ik-tests/useSceneStore.mjs');
  const {useSimulationStore:simulation}=await import('../.tmp/ik-tests/useSimulationStore.mjs');
  simulation.setState({run:42});scene.setState({objects:[],settings:{},selected:null,nextId:1,editing:true,past:[],future:[]});
  scene.getState().add('robot',{x:0,z:0});const id=scene.getState().selected;
  scene.getState().add('pallet',{x:-1,z:0});scene.getState().updatePose(id,{x:.5});scene.getState().updateSettings(id,{speed:2});scene.getState().select(id);scene.getState().remove(id);
  scene.getState().undo();if(scene.getState().settings[id].speed!==2||scene.getState().objects.find(o=>o.id===id).x!==.5||scene.getState().selected!==id)throw Error('Delete undo lost object properties/selection');
  scene.getState().undo();if(scene.getState().settings[id].speed!==1)throw Error('Settings undo failed');
  scene.getState().undo();if(scene.getState().objects.find(o=>o.id===id).x!==0)throw Error('Move undo failed');
  scene.getState().redo();if(scene.getState().objects.find(o=>o.id===id).x!==.5)throw Error('Move redo failed');
  scene.getState().add('conveyor',{x:2,z:0});const belt=scene.getState().selected;
  if(scene.getState().future.length)throw Error('New edit did not truncate redo history');
  scene.getState().extendConveyor(belt,'left');const extended=scene.getState().objects;scene.getState().undo();scene.getState().redo();
  if(scene.getState().objects!==extended)throw Error('Conveyor extension redo did not restore snapshot identity');
  scene.getState().clear();scene.getState().undo();if(scene.getState().objects!==extended)throw Error('Clear undo failed');
  const snapshot=scene.getState();scene.getState().updatePose(id,{x:.5});if(scene.getState()!==snapshot)throw Error('No-op created history');
  for(let i=1;i<160;i++)scene.getState().updatePose(id,{x:i});if(scene.getState().past.length!==100)throw Error('History is not bounded');
  scene.setState({editing:false});const runtime=scene.getState();scene.getState().undo();scene.getState().redo();scene.getState().remove(id);if(scene.getState()!==runtime)throw Error('Runtime keyboard actions changed layout');
  if(simulation.getState().run!==42)throw Error('Editor history reset the simulation');
  console.log('Editor history: add/move/settings/delete/extension/clear undo-redo, selection and settings restoration, branch truncation, identity, 100-entry limit and editing-only guards passed');process.exit(0);
}
if(process.argv.includes('--fleet')){
  const {OBB}=await import('three/addons/math/OBB.js');
  const {FactorySimulator}=await import('../.tmp/ik-tests/FactorySimulator.mjs');
  const {AMR_TRAFFIC}=await import('../.tmp/ik-tests/simulatorLayout.mjs');
  const assets={box:load('box'),pallet:load('pallet')};
  const {PalletController}=await import('../.tmp/ik-tests/PalletController.mjs');
  const ownPallet=new PalletController({id:'owned',name:'Owned pallet',kind:'pallet',x:3,z:-2,yaw:Math.PI/3},assets.pallet,2);
  if(ownPallet.beginShipment()!==null||!ownPallet.reserve(0)||ownPallet.reserve(0))throw Error('Pallet accepted incomplete shipment or duplicate reservation');
  ownPallet.release(0);if(ownPallet.states[0]!=='free')throw Error('Missed pickup did not release the pallet slot');
  const ownBox=new T.Group();ownBox.position.copy(ownPallet.slots[0]);const placedWorld=ownBox.getWorldPosition(new T.Vector3());
  ownPallet.reserve(0);ownPallet.place(0,ownBox,1);
  if(ownBox.getWorldPosition(new T.Vector3()).distanceTo(placedWorld)>1e-8||ownPallet.full)throw Error('Pallet attachment moved the placed box or completed early');
  ownPallet.reserve(1);ownPallet.place(1,new T.Group(),2);
  const outgoing=ownPallet.beginShipment();
  if(outgoing!==ownPallet.group||ownPallet.readyAt!==2||ownPallet.reserve(0))throw Error('Full pallet did not lock its shipment');
  const replacement=ownPallet.replace();
  if(replacement===outgoing||ownBox.parent!==outgoing||ownPallet.count||ownPallet.shipping||ownPallet.availableSlot!==0)throw Error('Pallet replacement damaged the outgoing cargo or did not reopen slots');
  const cell=(offset,index)=>[
    {id:`r${index}`,name:`Robot ${index}`,kind:'robot',x:offset,z:0,yaw:0},
    {id:`p${index}`,name:`Pallet ${index}`,kind:'pallet',x:offset-1.15,z:0,yaw:0},
    {id:`b${index}`,name:`Belt ${index}`,kind:'conveyor',x:offset+1.06875,z:0,yaw:0},
    {id:`a${index}`,name:`AMR ${index}`,kind:'amr',x:offset-3,z:-2,yaw:0},
    {id:`d${index}`,name:`Dock ${index}`,kind:'dock',x:offset-3,z:2,yaw:0},
  ];
  const make=(objects,random=()=>0)=>{const settings=Object.fromEntries(objects.map(o=>[o.id,{speed:1,enabled:true,reach:1.8,capacity:2,spawnInterval:1000}]));return {world:new FactorySimulator(objects,assets.box,assets.pallet,()=>settings,undefined,random),settings};};
  const fill=pallet=>{pallet.count=pallet.slots.length;pallet.states.fill('placed');};
  const exchange=make(cell(0,9).map(o=>o.kind==='dock'?{...o,z:8}:o));
  exchange.settings.r9.enabled=false;
  const source=exchange.world.pallets[0],oldGroup=source.group,oldCargo=exchange.world.boxes[0];
  oldCargo.state='placed';oldCargo.pallet=source.object.id;source.group.attach(oldCargo.node);fill(source);
  for(let frame=0;frame<30*60&&source.group===oldGroup;frame++)exchange.world.advance(1/30);
  if(source.group===oldGroup||source.shipping||source.count!==0||exchange.world.dispatched!==0)throw Error('Empty pallet was not supplied before dock delivery');
  const freshGroup=source.group,freshCargo=exchange.world.boxes.find(box=>box!==oldCargo);
  freshCargo.state='placed';freshCargo.pallet=source.object.id;source.group.attach(freshCargo.node);source.count=1;source.states[0]='placed';
  for(let frame=0;frame<30*60&&!exchange.world.dispatched;frame++)exchange.world.advance(1/30);
  if(exchange.world.dispatched!==1||source.group!==freshGroup||source.count!==1||!exchange.world.boxes.includes(freshCargo)||freshCargo.node.parent!==freshGroup||exchange.world.boxes.includes(oldCargo))throw Error('Previous shipment cleanup damaged the next pallet load');
  const independent=make([...cell(0,0),...cell(12,1)]);independent.world.advance(.05);
  const offGrid=make(cell(.1,4));fill(offGrid.world.pallets[0]);offGrid.world.advance(.05);
  if(offGrid.world.agents[0].dispatch.phase==='idle')throw Error('Valid off-grid pallet remains in route waiting');
  for(const offset of [.05,.15,.25,-.1,-.25]){const shifted=make(cell(offset,5));fill(shifted.world.pallets[0]);shifted.world.advance(.05);if(shifted.world.agents[0].dispatch.phase==='idle')throw Error(`Off-grid dispatch stuck at ${offset}`);}
  const alternate=make([...cell(0,6).map(o=>o.kind==='dock'?{...o,x:0,z:0}:o),{id:'alternate',name:'Alternate dock',kind:'dock',x:-3,z:2,yaw:0}]);fill(alternate.world.pallets[0]);alternate.world.advance(.05);
  if(alternate.world.agents[0].dispatch.phase==='idle')throw Error('Blocked closest dock prevented using alternate dock');
  const invalid=make(cell(0,7).map(o=>o.kind==='pallet'?{...o,x:0,z:0}:o));fill(invalid.world.pallets[0]);invalid.world.advance(.05);
  if(!invalid.world.equipment.agents[0].status.includes('공간이 부족'))throw Error('Static blockage still shown as generic waiting');
  if(independent.world.agents.some(a=>a.dispatch.phase!=='idle'))throw Error('Incomplete pallet dispatched');
  independent.world.pallets.forEach(fill);for(let i=0;i<25;i++)independent.world.advance(.05);
  if(independent.world.agents.filter(a=>a.dispatch.phase!=='idle').length!==2)throw Error('Independent AMR routes did not run concurrently');
  let parallel=0,trafficStops=0;
  const radius=a=>['loading','dispatch','unloading'].includes(a.dispatch.phase)?AMR_TRAFFIC.loadedRadius:AMR_TRAFFIC.emptyRadius;
  const run=(world,settings)=>{
    for(let frame=0;frame<30*180;frame++){
      if(frame===60)for(const agent of world.agents)settings[agent.object.id].speed=agent===world.agents[0]?1.5:.75;
      world.advance(1/30);
      trafficStops+=world.agents.filter(a=>a.dispatch.yielding).length;
      parallel=Math.max(parallel,world.agents.filter(a=>a.dispatch.phase!=='idle').length);
      for(let i=0;i<world.agents.length;i++)for(let j=i+1;j<world.agents.length;j++)if(world.agents[i].dispatch.carrier.position.distanceTo(world.agents[j].dispatch.carrier.position)<radius(world.agents[i])+radius(world.agents[j])-1e-6)throw Error('AMRs collided');
      for(const agent of world.agents.filter(a=>['loading','dispatch','unloading'].includes(a.dispatch.phase))){
        const pallet=world.pallets.find(p=>p.object.name===agent.target),position=agent.dispatch.carrier.position;
        const payloadBounds=new OBB(new T.Vector3(),new T.Vector3(.55,.5,.55)).applyMatrix4(new T.Matrix4().makeRotationY(pallet.object.yaw).setPosition(position));
        for(const robot of world.robots){
          const obstacleBounds=new OBB(new T.Vector3(),new T.Vector3(.325,.5,.325)).applyMatrix4(new T.Matrix4().makeRotationY(robot.object.yaw).setPosition(robot.object.x,0,robot.object.z));
          if(payloadBounds.intersectsOBB(obstacleBounds))throw Error('Loaded pallet crossed a rotated robot base');
        }
      }
      if(world.dispatched>=2&&world.agents.every(a=>a.dispatch.phase==='idle'))return;
    }throw Error(`Fleet dispatch/return did not complete: ${JSON.stringify(world.agents.map(a=>({id:a.object.id,phase:a.dispatch.phase,position:a.dispatch.carrier.position.toArray(),yielding:a.dispatch.yielding,path:a.dispatch.path.map(p=>p.toArray()),completed:a.completed})))}`);
  };
  run(independent.world,independent.settings);
  const sharedObjects=[...cell(0,0),...cell(8,1)].filter(o=>o.id!=='d1');
  const shared=make(sharedObjects);shared.world.pallets.forEach(fill);shared.world.advance(.05);
  if(shared.world.pallets.filter(p=>p.shipping).length!==2)throw Error('Overlapping routes prevented concurrent task assignment');
  run(shared.world,shared.settings);
  const adjacent=make([
    ...cell(0,8).filter(o=>o.kind!=='pallet'&&o.kind!=='robot'),
    {id:'ar1',name:'Robot A',kind:'robot',x:0,z:-.85,yaw:0},
    {id:'ar2',name:'Robot B',kind:'robot',x:0,z:.85,yaw:Math.PI/6},
    {id:'ap1',name:'Pallet A',kind:'pallet',x:-1.15,z:-.85,yaw:0},
    {id:'ap2',name:'Pallet B',kind:'pallet',x:-1.15,z:.85,yaw:0},
    {id:'aa2',name:'AMR B',kind:'amr',x:-3,z:-3.5,yaw:0},
  ]);adjacent.world.pallets.forEach(fill);run(adjacent.world,adjacent.settings);
  if(adjacent.world.agents.some(agent=>agent.completed!==1))throw Error('Adjacent pallets were not distributed between the two AMRs');
  if(!trafficStops)throw Error('Intersecting traffic never yielded');
  const {AMRTrafficController}=await import('../.tmp/ik-tests/AMRTrafficController.mjs');
  const {PalletDispatchController}=await import('../.tmp/ik-tests/PalletDispatchController.mjs');
  const {layoutPath}=await import('../.tmp/ik-tests/layoutNavigation.mjs');
  const {DEFAULT_LAYOUT}=await import('../.tmp/ik-tests/simulatorLayout.mjs');
  const openLayout={...DEFAULT_LAYOUT,robot:{x:50,z:50,yaw:0},conveyor:{x:55,z:50,yaw:0}};
  let headOnCompleted=0,headOnStops=0;
  const headOn=[-1,1].map((side,index)=>{
    const home=new T.Vector3(side*3,0,0),pickup=new T.Vector3(-side*1.5,0,0),dock=new T.Vector3(-side*1.5,0,-side*3);
    const dispatch=new PalletDispatchController({...openLayout,amr:{x:home.x,z:home.z,yaw:0}});
    dispatch.request(new T.Group(),()=>headOnCompleted++,{pickup:[home.clone(),pickup],dispatch:[pickup.clone(),dock],returning:[dock.clone(),home.clone()]});
    return {id:`head-on-${index}`,dispatch,speed:1,enabled:true};
  });
  const traffic=new AMRTrafficController();
  for(let frame=0;frame<30*180;frame++){
    if(frame===40){headOn[0].speed=3;headOn[1].speed=.5;}
    traffic.advance(headOn,frame%7===0?.2:1/30,vehicle=>layoutPath(openLayout,vehicle.dispatch.carrier.position,vehicle.dispatch.path.at(-1),vehicle.dispatch.radius===AMR_TRAFFIC.loadedRadius,headOn.filter(other=>other!==vehicle).map(other=>({kind:'amr',pose:{x:other.dispatch.carrier.position.x,z:other.dispatch.carrier.position.z,yaw:0},radius:other.dispatch.radius+AMR_TRAFFIC.safetyMargin}))));
    headOnStops+=headOn.filter(vehicle=>vehicle.dispatch.yielding).length;
    if(headOn[0].dispatch.carrier.position.distanceTo(headOn[1].dispatch.carrier.position)<headOn[0].dispatch.radius+headOn[1].dispatch.radius-1e-6)throw Error('Head-on traffic collided');
    if(headOnCompleted===2&&headOn.every(vehicle=>vehicle.dispatch.phase==='idle'))break;
  }
  if(headOnCompleted!==2||!headOnStops||headOn.some(vehicle=>vehicle.dispatch.phase!=='idle'))throw Error(`Head-on traffic failed to yield, detour and resume: ${headOnCompleted}/${headOnStops} ${JSON.stringify(headOn.map(v=>({phase:v.dispatch.phase,at:v.dispatch.carrier.position.toArray(),path:v.dispatch.path.map(p=>p.toArray())})))}`);
  const fair=make(sharedObjects.filter(o=>o.id!=='a1'));fair.world.pallets.forEach(fill);fair.world.advance(.05);
  const pending=fair.world.pallets.find(p=>!p.shipping),first=fair.world.pallets.find(p=>p.shipping);
  let refilled=false,servedOldest=false;
  for(let frame=0;frame<30*180;frame++){
    fair.world.advance(1/30);
    if(fair.world.dispatched===1&&!refilled){fill(first);refilled=true;}
    if(refilled&&pending.shipping){servedOldest=true;break;}
    if(refilled&&first.shipping)throw Error('Newly refilled pallet overtook an older completed pallet');
  }
  if(!servedOldest)throw Error('Oldest completed pallet was starved');
  const random=make([...cell(0,0),{id:'far',name:'Far AMR',kind:'amr',x:-3,z:-3.5,yaw:0}],()=>.99);fill(random.world.pallets[0]);random.world.advance(.05);
  if(random.world.agents.find(a=>a.object.id==='far').dispatch.phase==='idle')throw Error('Random idle AMR selection still always picks nearest');
  const metrics=independent.world.equipment;
  if(metrics.pallets.length!==2||metrics.agents.some(a=>a.completed!==1)||metrics.robots.some(r=>r.utilization<0||r.utilization>100))throw Error('Fleet telemetry invalid');
  console.log('Fleet: overlapping-route assignment, local collision yielding/resume, adjacent pallets, shared dock, parked AMR detour, changed speeds, collision-free delivery/return and oldest-completed queue passed');process.exit(0);
}
if(process.argv.includes('--instances')){
  const {SceneInstances}=await import('../.tmp/ik-tests/SceneInstances.mjs');
  const {conveyorTemplate}=await import('../.tmp/ik-tests/conveyorTemplate.mjs');
  const batch=new SceneInstances(),scene=new T.Group(),models=[];
  scene.add(batch.root);
  for(let i=0;i<1000;i++){
    const model=conveyorTemplate(['straight','left','right'][i%3]).clone(true);
    model.position.set((i%40)*3,0,Math.floor(i/40)*3);scene.add(model);models.push(model);batch.register(model);
  }
  batch.sync();
  if(batch.root.children.length!==7)throw Error(`Expected 7 draw batches, got ${batch.root.children.length}`);
  if(batch.root.children.reduce((sum,mesh)=>sum+mesh.count,0)!==4000)throw Error('Lost conveyor mesh instances');
  const versions=batch.root.children.map(mesh=>mesh.instanceMatrix.version);batch.sync();
  if(batch.root.children.some((mesh,i)=>mesh.instanceMatrix.version!==versions[i]))throw Error('Static instances upload every frame');
  const owner=models[0],body=owner.children[0],matrix=new T.Matrix4();
  const mesh=batch.root.children.find(mesh=>mesh.geometry===body.geometry),index=mesh.userData.instanceOwners.indexOf(owner);
  owner.position.set(200,0,0);batch.sync();mesh.getMatrixAt(index,matrix);
  if(Math.abs(matrix.elements[12]-200)>1e-5)throw Error('Moved object matrix stale');
  const carrier=new T.Group();carrier.position.set(4,2,1);scene.add(carrier);carrier.attach(owner);carrier.position.x+=2;batch.sync();mesh.getMatrixAt(index,matrix);
  if(Math.abs(matrix.elements[12]-202)>1e-5)throw Error('Attached object did not follow parent');
  batch.unregister(owner);batch.sync();if(!body.visible||body.raycast===undefined)throw Error('Unregistered source was not restored');
  batch.dispose();if(batch.root.children.length||models.some(model=>model.children.some(mesh=>!mesh.visible)))throw Error('Instance cleanup failed');
  const attachment=new SceneInstances(),arm=new T.Group(),wrist=new T.Mesh(new T.BoxGeometry(.1,.1,.1),new T.MeshBasicMaterial()),heldCargo=new T.Group();
  arm.add(wrist);heldCargo.add(new T.Mesh(new T.BoxGeometry(.2,.2,.2),new T.MeshBasicMaterial()));
  attachment.register(arm);attachment.register(heldCargo);wrist.attach(heldCargo);attachment.sync();
  const heldBatch=attachment.root.children.find(mesh=>mesh.userData.instanceOwners.includes(heldCargo));heldBatch.getMatrixAt(0,matrix);
  if(Math.abs(matrix.determinant())<1e-8)throw Error('Held cargo disappeared beneath an instanced wrist mesh');
  for(let edit=0;edit<3;edit++){
    attachment.unregister(arm);attachment.unregister(heldCargo);
    attachment.register(arm);attachment.register(heldCargo);arm.position.x+=1;attachment.sync();
    const visibleCargo=attachment.root.children.find(mesh=>mesh.userData.instanceOwners.includes(heldCargo));
    visibleCargo.getMatrixAt(0,matrix);
    if(Math.abs(matrix.determinant())<1e-8||attachment.root.children.reduce((sum,mesh)=>sum+mesh.count,0)!==2)throw Error('Editing/reconnecting lost or duplicated held cargo');
  }
  arm.visible=false;attachment.sync();attachment.root.children.find(mesh=>mesh.userData.instanceOwners.includes(heldCargo)).getMatrixAt(0,matrix);
  if(Math.abs(matrix.determinant())>1e-8)throw Error('Explicitly hidden assembly still rendered');
  arm.visible=true;attachment.dispose();
  const {SelectionOutline}=await import('../.tmp/ik-tests/SelectionOutline.mjs');
  const selection=new SceneInstances(),outline=new SelectionOutline(),selectionRoot=new T.Group(),selectedModel=new T.Group();
  selectionRoot.userData.sceneId='robot';selectedModel.add(new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()));selectionRoot.add(selectedModel);
  const selectedCargo=new T.Group();selectedCargo.userData.sceneId='cargo';selectedCargo.add(new T.Mesh(new T.BoxGeometry(.2,.2,.2),new T.MeshBasicMaterial()));
  selection.register(selectedModel);selection.register(selectedCargo);selectedModel.children[0].add(selectedCargo);selection.sync();
  let sourceDisposed=false;selectedModel.children[0].geometry.addEventListener('dispose',()=>{sourceDisposed=true;});
  outline.sync(selection,'robot',new T.Vector2(800,600));
  if(outline.root.children.length!==1)throw Error('Selection outline included cargo owned by another object');
  selectionRoot.position.x=4;selection.sync();outline.sync(selection,'robot',new T.Vector2(800,600));
  if(Math.abs(outline.root.children[0].matrix.elements[12]-4)>1e-8)throw Error('Selection outline did not follow movement');
  selectionRoot.visible=false;selection.sync();outline.sync(selection,'robot',new T.Vector2(800,600));
  if(outline.root.children.length)throw Error('Hidden selection still outlined');
  selectionRoot.visible=true;selection.sync();outline.sync(selection,'cargo',new T.Vector2(800,600));
  if(outline.root.children.length!==1)throw Error('Selection change lost the outline');
  outline.sync(selection,null,new T.Vector2(800,600));if(outline.root.children.length)throw Error('Deselection left an outline');
  outline.dispose();if(sourceDisposed)throw Error('Outline disposed shared model geometry');selection.dispose();
  const {FactorySimulator}=await import('../.tmp/ik-tests/FactorySimulator.mjs');
  const objects=[{id:'belt',name:'Belt',kind:'conveyor',x:0,z:0,yaw:0}],settings={belt:{speed:1,enabled:true,spawnInterval:1000}};
  const runtime=new SceneInstances(),world=new FactorySimulator(objects,load('box'),load('pallet'),()=>settings,runtime);
  world.connectInstances();runtime.sync();
  if(!runtime.root.children.length||runtime.root.children.some(mesh=>mesh.count!==3))throw Error('Runtime cargo not instanced');
  const cargo=world.boxes[0],hand=new T.Group();hand.position.set(3,2,0);hand.attach(cargo.node);hand.position.z=4;runtime.sync();
  const cargoBatch=runtime.root.children[0],slot=cargoBatch.userData.instanceOwners.indexOf(cargo.node);cargoBatch.getMatrixAt(slot,matrix);
  if(Math.abs(matrix.elements[14]-cargo.node.children[0].children[0].matrixWorld.elements[14])>1e-4)throw Error('Held cargo render pose differs from source');
  world.dispose();runtime.sync();if(runtime.root.children.length)throw Error('Runtime disposal leaked batches');
  console.log('Instances: 1,000 mixed conveyors / 4,000 meshes rendered in 7 batches; static GPU uploads skipped; moved/attached transforms, runtime cargo, removal and cleanup passed');
  process.exit(0);
}
if(process.argv.includes('--flow-speed')){
  const {FactorySimulator}=await import('../.tmp/ik-tests/FactorySimulator.mjs');
  const {beltLength,extendBelt}=await import('../.tmp/ik-tests/conveyorLayout.mjs');
  const {simulationDelta}=await import('../.tmp/ik-tests/simulationTime.mjs');
  const {useSimulationStore:simulation}=await import('../.tmp/ik-tests/useSimulationStore.mjs');
  const {useSceneStore:scene}=await import('../.tmp/ik-tests/useSceneStore.mjs');
  const a={id:'a',kind:'conveyor',name:'A',x:0,z:0,yaw:0},b={...extendBelt(a,'straight'),id:'b',kind:'conveyor',name:'B'},c={...extendBelt(b,'left'),id:'c',kind:'conveyor',name:'C'};
  const settings=Object.fromEntries([a,b,c].map(o=>[o.id,{speed:1,enabled:true,spawnInterval:8}]));
  const world=new FactorySimulator([a,b,c],load('box'),load('pallet'),()=>settings);
  if(![a,b,c].every(belt=>world.boxes.some(box=>box.belt===belt)))throw Error('Connected line starts empty downstream');
  const initial=world.spawned,first=world.boxes[0];
  for(let i=0;i<30*8+1;i++)world.advance(1/30);
  if(world.spawned<=initial||first.belt!==a||first.distance>=beltLength(a))throw Error('Inlet waited for a box to reach the end');
  const firstA=world.boxes.find(box=>box.belt===a),firstB=world.boxes.find(box=>box.belt===b),startA=firstA.distance,startB=firstB.distance;
  settings.b.speed=2;world.advance(.1);
  if(Math.abs((firstB.distance-startB)/(firstA.distance-startA)-2)>1e-6)throw Error('Per-segment speed not independent');
  const solo=new FactorySimulator([a],load('box'),load('pallet'),()=>({a:{speed:1.5,enabled:true,spawnInterval:1000}})),soloBox=solo.boxes[0];
  for(let i=0;i<60;i++)solo.advance(simulationDelta(1/30,2));
  if(Math.abs(soloBox.distance-.0625*2*2*1.5)>1e-8||Math.abs(simulationDelta(1/30,2,1.5)-.1)>1e-8)throw Error('Global and local speeds do not compose');
  simulation.setState({run:20,running:true});simulation.getState().setSpeed(2);
  if(simulation.getState().run!==20||!simulation.getState().running||simulation.getState().speed!==2)throw Error('Playback change restarted runtime');
  simulation.getState().setSpeed(0);if(simulation.getState().speed!==2)throw Error('Invalid playback speed accepted');
  scene.getState().example();scene.getState().complete();simulation.getState().setRunning(true);
  const run=simulation.getState().run,belt=scene.getState().objects.find(o=>o.kind==='conveyor');scene.getState().updateSettings(belt.id,{spawnInterval:4});
  if(simulation.getState().run!==run||!simulation.getState().running)throw Error('Live feed interval reset boxes');
  const isolated={...a,id:'isolated',x:100};
  const configs=Object.fromEntries([a,b,c,isolated].map(o=>[o.id,{speed:1,enabled:true,spawnInterval:8}]));
  scene.setState({objects:[a,b,c,isolated],settings:configs,editing:true,past:[],future:[]});
  scene.getState().updateSettings('b',{speed:2,spawnInterval:4});
  if(![a,b,c].every(o=>scene.getState().settings[o.id].speed===2)||scene.getState().settings.isolated.speed!==1)throw Error('Connected speed did not propagate both directions or changed isolated belt');
  if(scene.getState().settings.a.spawnInterval!==8||scene.getState().settings.b.spawnInterval!==4)throw Error('Non-speed settings propagated');
  scene.getState().undo();
  if(![a,b,c].every(o=>scene.getState().settings[o.id].speed===1))throw Error('Connected speed undo was not atomic');
  scene.getState().redo();
  if(![a,b,c].every(o=>scene.getState().settings[o.id].speed===2))throw Error('Connected speed redo failed');
  scene.setState({editing:false});
  scene.getState().updateSettings('c',{speed:3});
  if(![a,b,c].every(o=>scene.getState().settings[o.id].speed===3)||simulation.getState().run!==run||!simulation.getState().running)throw Error('Live connected speed failed or reset runtime');
  console.log('Flow/speed: continuous flow, global timing, bidirectional connected speed, isolated belt preservation, settings isolation, undo/redo and live updates without reset passed');
  process.exit(0);
}
if(process.argv.includes('--unbounded-layout')){
  const {useSceneStore:scene}=await import('../.tmp/ik-tests/useSceneStore.mjs');
  const {validateScene}=await import('../.tmp/ik-tests/sceneValidation.mjs');
  const {layoutPath,clearanceAt}=await import('../.tmp/ik-tests/layoutNavigation.mjs');
  const {DEFAULT_LAYOUT}=await import('../.tmp/ik-tests/simulatorLayout.mjs');
  scene.getState().example();
  for(const object of scene.getState().objects)scene.getState().updatePose(object.id,{x:object.x+120,z:object.z-85});
  if(validateScene(scene.getState().objects,scene.getState().settings).length)throw Error('Distant scene rejected');
  const belt=scene.getState().objects.find(o=>o.kind==='conveyor');
  scene.getState().extendConveyor(belt.id,'straight');
  for(let i=0;i<10;i++)scene.getState().extendConveyor(scene.getState().selected,'straight');
  if(scene.getState().objects.length!==18||scene.getState().errors.length)throw Error('Distant extension blocked');
  for(const offset of [{x:0,z:0},{x:120,z:-85},{x:-200,z:300}]){
    const layout=Object.fromEntries(Object.entries(DEFAULT_LAYOUT).map(([kind,pose])=>[kind,{...pose,x:pose.x+offset.x,z:pose.z+offset.z}]));
    for(const [start,goal,loaded] of [[layout.amr,layout.pallet,false],[layout.pallet,layout.dock,true]]){
      const route=layoutPath(layout,start,goal,loaded,[{kind:'robot',pose:{x:100000,z:100000,yaw:0}}]);
      if(!route)throw Error('Distant AMR route blocked');
      for(const p of route)if(clearanceAt(p.x,p.z,'robot',layout)<(loaded?.82:.4)-1e-8||clearanceAt(p.x,p.z,'conveyor',layout)<(loaded?.82:.4)-1e-8)throw Error('Distant AMR clearance violated');
    }
  }
  console.log('Unbounded layout: translated scene validation, repeated distant conveyor extensions, AMR pickup/dispatch at positive and negative world coordinates, irrelevant distant obstacles passed');
  process.exit(0);
}
if(process.argv.includes('--conveyor-layout')){
  const {beltPoint,beltLength,extendBelt,beltConnections,snapBelt}=await import('../.tmp/ik-tests/conveyorLayout.mjs');
  const {useSceneStore:scene}=await import('../.tmp/ik-tests/useSceneStore.mjs');
  const {clearancePose}=await import('../.tmp/ik-tests/layoutNavigation.mjs');
  const near=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z)<1e-8&&Math.cos(a.yaw-b.yaw)>1-1e-8;
  for(const yaw of [0,.7,-1.8])for(const turn of ['left','straight','right']){
    const a={id:'a',name:'A',kind:'conveyor',x:0,z:0,yaw},b={...extendBelt(a,turn),id:'b',name:'B',kind:'conveyor'};
    if(!near(beltPoint(a,beltLength(a)),beltPoint(b,0)))throw Error('Disconnected extension');
    const c={...extendBelt(b,'straight'),id:'c',name:'C',kind:'conveyor'};
    if(!near(beltPoint(b,beltLength(b)),beltPoint(c,0)))throw Error('Disconnected curved exit');
    const graph=beltConnections([a,b,c]);
    if(graph.next.get('a')!==b||graph.next.get('b')!==c||graph.incoming.has('a'))throw Error('Incorrect graph');
    const snapped=snapBelt({...b,x:b.x+.1,z:b.z+.1},[a]);
    if(!near(beltPoint(snapped,0),beltPoint(a,beltLength(a))))throw Error('Snap failed');
    if(Math.abs(beltLength(b)-(turn==='straight'?2.5:Math.PI*1.25/2))>1e-8)throw Error('Incorrect path length');
    if(turn!=='straight'){
      for(let i=0;i<=20;i++){const p=beltPoint(b,beltLength(b)*i/20);if(clearancePose(p.x,p.z,'conveyor',b)>1e-8)throw Error('AMR obstacle misses curved belt');}
    }
  }
  scene.getState().clear();scene.getState().add('conveyor',{x:0,z:-2.5});
  const id=scene.getState().selected;scene.getState().extendConveyor(id,'left');
  if(scene.getState().objects.length!==2)throw Error('Extension not added');
  scene.getState().extendConveyor(id,'right');
  if(scene.getState().objects.length!==2)throw Error('Occupied endpoint duplicated');
  scene.getState().remove(scene.getState().selected);scene.getState().extendConveyor(id,'right');
  if(scene.getState().objects.length!==2)throw Error('Deleted endpoint did not reconnect');
  const {FactorySimulator}=await import('../.tmp/ik-tests/FactorySimulator.mjs');
  const a={id:'a',name:'A',kind:'conveyor',x:0,z:-2.5,yaw:0};
  const b={...extendBelt(a,'left'),id:'b',name:'B',kind:'conveyor'},c={...extendBelt(b,'right'),id:'c',name:'C',kind:'conveyor'};
  const objects=[a,b,c],settings=Object.fromEntries(objects.map(o=>[o.id,{speed:1,enabled:true,spawnInterval:1000}]));
  const world=new FactorySimulator(objects,load('box'),load('pallet'),()=>settings);
  const initial=world.spawned;if(!world.boxes.length||world.belts.some(belt=>belt.elapsed!==0))throw Error('Invalid initial conveyor seed');
  const cargo=world.boxes[0];cargo.distance=beltLength(a)-.001;world.advance(.05);
  if(cargo.belt!==b||cargo.node.position.distanceTo(new T.Vector3(beltPoint(b,cargo.distance).x,cargo.node.position.y,beltPoint(b,cargo.distance).z))>1e-8)throw Error('Cargo did not follow curved segment');
  cargo.distance=beltLength(b)-.001;world.advance(.05);if(cargo.belt!==c)throw Error('Cargo did not transfer to next curve');
  cargo.distance=beltLength(c)+.1;world.advance(.01);if(world.passed!==1||world.spawned!==initial)throw Error('Cargo exit caused a new box or final exit failed');
  const loop=[{...a,x:0,z:0,conveyorTurn:'left'}];
  for(let i=1;i<4;i++)loop.push({...extendBelt(loop[i-1],'left'),id:`loop-${i}`,name:'Loop',kind:'conveyor'});
  const loopSettings=Object.fromEntries(loop.map(o=>[o.id,{speed:1,enabled:true,spawnInterval:2}]));
  const loopWorld=new FactorySimulator(loop,load('box'),load('pallet'),()=>loopSettings);
  for(let i=0;i<400;i++)loopWorld.advance(.1);
  if(loopWorld.spawned!==3||loopWorld.passed!==0)throw Error('Closed loop did not circulate seeded boxes');
  console.log('Conveyors: rotated straight/left/right continuity, snapping, graph, occupied/deleted endpoints, source-only spawn, curved cargo transfer and final exit passed');
  process.exit(0);
}
if(process.argv.includes('--scene-state')){
  const {useSceneStore:scene}=await import('../.tmp/ik-tests/useSceneStore.mjs');
  const {useSimulationStore:simulation}=await import('../.tmp/ik-tests/useSimulationStore.mjs');
  simulation.setState({run:10,sceneMode:'simulator',running:false});
  let resets=0;
  const unsubscribe=simulation.subscribe(()=>resets++);
  scene.getState().example();
  const original=scene.getState().objects,first=original[0],second=original[1],secondSettings=scene.getState().settings[second.id];
  scene.getState().updatePose(first.id,{x:.01});
  if(scene.getState().objects[1]!==second)throw Error('Moving one object replaced another object');
  const unchanged=scene.getState();scene.getState().updatePose(first.id,{x:.01});
  if(scene.getState()!==unchanged)throw Error('Unchanged pose still updates state');
  scene.getState().updateSettings(first.id,{speed:1.5});
  if(scene.getState().settings[second.id]!==secondSettings)throw Error('Changing speed replaced another object settings');
  const sameSettings=scene.getState();scene.getState().updateSettings(first.id,{speed:1.5});
  if(scene.getState()!==sameSettings)throw Error('Unchanged settings still update state');
  scene.getState().select(first.id);scene.getState().select(second.id);
  scene.getState().add('robot',{x:2,z:0});
  scene.getState().remove(scene.getState().selected);
  const pallet=scene.getState().objects.find(o=>o.kind==='pallet');scene.getState().updateSettings(pallet.id,{capacity:40});
  // Floor/wall asset: grid snapping, size edits, undo/redo round trip and runtime coexistence.
  scene.getState().add('floor',{x:2.3,z:-1.2,floor:{width:3,depth:2,wallHeight:2.5}});
  const floorId=scene.getState().selected,floorAt=()=>scene.getState().objects.find(o=>o.id===floorId);
  if(floorAt()?.kind!=='floor'||floorAt().x!==2.5||floorAt().z!==-1||floorAt().floor.width!==3||floorAt().floor.depth!==2||floorAt().floor.wallHeight!==2.5)throw Error('Floor was not snapped to the 1-unit grid with its size');
  scene.getState().updateFloor(floorId,{wallHeight:0});
  if(floorAt().floor.wallHeight!==0)throw Error('Floor wall height did not update');
  scene.getState().undo();if(floorAt().floor.wallHeight!==2.5)throw Error('Floor undo did not restore the wall height');
  scene.getState().redo();if(floorAt().floor.wallHeight!==0)throw Error('Floor redo did not reapply the wall height');
  const floorState=scene.getState();scene.getState().updateFloor(floorId,{width:0});scene.getState().updateFloor(floorId,{depth:1.5});
  if(scene.getState()!==floorState)throw Error('Invalid floor size changed the scene');
  scene.getState().updateFloor(floorId,{width:4});if(floorAt().x!==3&&floorAt().x!==2)throw Error('Resized floor left the grid');
  scene.getState().updatePose(floorId,{x:.2});if(floorAt().x!==0)throw Error('Moved floor was not grid-snapped');
  if(simulation.getState().run!==10||resets!==0)throw Error('Editing reset the simulation or recreated the scene');
  scene.getState().complete();
  if(scene.getState().errors.length||!floorAt())throw Error('Floor blocked completing the layout');
  if(scene.getState().editing||simulation.getState().run!==11)throw Error('Completing the layout did not initialize exactly one runtime');
  scene.getState().select(first.id);
  if(scene.getState().inspected!==null||scene.getState().selected!==first.id)throw Error('Single click opened details');
  scene.getState().inspect(first.id);
  if(scene.getState().inspected!==first.id)throw Error('Double click did not open details');
  scene.getState().select(second.id);
  if(scene.getState().inspected!==null||scene.getState().selected!==second.id)throw Error('Selecting another card did not close details');

  scene.getState().updateSettings(first.id,{speed:2});
  if(simulation.getState().run!==11)throw Error('Live speed change restarted the runtime');
  scene.getState().updateSettings(pallet.id,{capacity:20});
  if(simulation.getState().run!==12)throw Error('Runtime capacity change did not restart runtime');
  const objects=scene.getState().objects;simulation.getState().reset();
  if(scene.getState().objects!==objects)throw Error('Runtime reset replaced editable objects');
  scene.getState().edit();const run=simulation.getState().run;scene.getState().edit();
  if(simulation.getState().run!==run)throw Error('Entering existing editor caused a reset');
  unsubscribe();
  console.log('Scene state: editing never resets runtime; stable object identities; no-op updates; live speed; runtime-only initialization and reset; floor/wall grid snap, size edits and undo/redo passed');
  process.exit(0);
}
const { createRobotIK } = await import(new URL('../.tmp/ik-tests/robotIK.mjs',import.meta.url));
const { ConveyorSimulator }=await import(new URL('../.tmp/ik-tests/ConveyorSimulator.mjs',import.meta.url));
const { createUnitBox, createUnitPallet }=await import('../.tmp/ik-tests/modelNormalization.mjs');
const { BOX_SIZES: PRODUCTION_BOX_SIZES, STREAM_CONFIG }=await import(new URL('../.tmp/ik-tests/constants.mjs',import.meta.url));
const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm,'').replaceAll('export ','');
const compile = source => ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
let demoSource = strip(fs.readFileSync('src/legacy/robot/RobotDemo.tsx','utf8')).replace('default function RobotDemo','function Demo');
if(process.env.IK_BATCH_COUNT)demoSource=demoSource.replace(/BOX_COUNT\s*=\s*\d+/,`BOX_COUNT = ${Number(process.env.IK_BATCH_COUNT)}`);
demoSource = demoSource.slice(0,demoSource.lastIndexOf('  return ('))+'return demo;}';
const stacking = compile(strip(fs.readFileSync('src/utils/packing/stacking.ts','utf8')));
const demoFactory = new Function('useGLTF','useMemo','useRef','useEffect','Box3','Group','Vector3','boxUrl','palletUrl','createUnitBox','createUnitPallet','STREAM_CONFIG','BOX_SIZES','ROBOT_PICKING',stacking+compile(demoSource)+';return Demo({running:true,onProgress:()=>{}});');
const makeDemo=(...args)=>demoFactory(...args,createUnitBox,createUnitPallet,STREAM_CONFIG,PRODUCTION_BOX_SIZES,ROBOT_PICKING);
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
  if(options.position)model.position.add(options.position);
  if(options.yaw)model.rotation.y+=options.yaw;
  const controller = new Controller({ id: 'fixture', model, geometryScale, pickupRadius:options.pickupRadius, transferMode:options.transferMode, getJobs: () => jobs.current,
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
  for (const degrees of [-540, 540]) {
    first.setJointAngle('hand01', degrees);
    first.update(0);
    if (Math.abs(first.getJointAngles().find(angle => angle.name === 'hand01').degrees - degrees) > 1e-6) throw Error('Shoulder angle is still limited');
  }
  first.setJointAngle('hand03', 90);
  first.update(0);
  if (Math.abs(first.getJointAngles().find(angle => angle.name === 'hand03').degrees - initial.find(angle => angle.name === 'hand03').degrees) > 1e-6) throw Error('Locked hand03 moved');
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
  const Controller=controllerClass(),controller=new Controller({id:'idle-home',model:load('robot'),getJobs:()=>[]});
  const initial=controller.getJointAngles().map(joint=>({name:joint.name,degrees:joint.degrees}));
  controller.setJointAngle('hand00',60);controller.update(0);
  controller.setJointAngle('hand01',-30);controller.update(0);
  controller.start();controller.update(1/60);
  if(Math.abs(controller.getJointAngles().find(joint=>joint.name==='hand00').degrees)<1)throw Error('Idle home return snapped instead of animating');
  controller.pause();const paused=controller.getJointAngles().map(joint=>joint.degrees);controller.update(1);
  if(controller.getJointAngles().some((joint,i)=>joint.degrees!==paused[i]))throw Error('Paused idle robot moved');
  controller.start();for(let i=0;i<1200;i++)controller.update(1/60);
  if(controller.getJointAngles().some(joint=>Math.abs(joint.degrees-initial.find(start=>start.name===joint.name).degrees)>1e-5))throw Error('Idle robot did not return to initial pose');
  controller.dispose();console.log('Idle home: smooth initial-pose return and pause/resume passed');
}
{
  // hand00 is continuous: turns accumulated by earlier jobs must not be unwound in place.
  const Controller=controllerClass(),controller=new Controller({id:'base-turns',model:load('robot'),getJobs:()=>[]});
  const base=controller.ik.baseControl,initial=base.angle;
  controller.setJointAngle('hand00',initial*180/Math.PI+5*360+30);controller.update(0);
  const wound=base.angle;let farthest=0;
  // Measure physical travel: wrapping at rest shifts the reading by whole turns, not the pose.
  let previous=wound,travel=0;
  controller.start();for(let i=0;i<1200;i++){controller.update(1/60);travel+=Math.atan2(Math.sin(base.angle-previous),Math.cos(base.angle-previous));previous=base.angle;farthest=Math.max(farthest,Math.abs(travel));}
  const residual=Math.atan2(Math.sin(base.angle-initial),Math.cos(base.angle-initial));
  if(farthest>Math.PI+1e-6)throw Error(`Idle home spun hand00 ${(farthest/Math.PI/2).toFixed(2)} turns instead of the nearest heading`);
  if(Math.abs(residual)>1e-5)throw Error('Idle home did not restore the initial hand00 heading');
  const reported=controller.getJointAngles().find(joint=>joint.name==='hand00').degrees;
  if(Math.abs(base.angle)>Math.PI+1e-9||Math.abs(reported)>180+1e-6)throw Error(`Idle hand00 was not wrapped into ±180° (${reported.toFixed(1)}°)`);
  controller.dispose();console.log('Base turns: idle home returns by the nearest hand00 heading without multi-turn spin and wraps hand00 into ±180° at rest passed');
}
{
  const ik=createRobotIK(load('robot'),1,'none');
  const target=ik.grip.getWorldPosition(new T.Vector3()).add(new T.Vector3(0,.05,0));
  const search=ik.prepareShoulderTransfer(target,target.clone().add(new T.Vector3(-.2,0,0)),target.clone().add(new T.Vector3(-.2,-.1,0)));
  const controls=[ik.baseControl,...ik.controls];
  for(let frame=0;frame<80;frame++){
    setJointAngle(controls[1],controls[1].angle+.0001);
    const before=controls.map(c=>c.angle);
    const step=search.next();
    if(controls.some((c,i)=>Math.abs(c.angle-before[i])>1e-9))throw Error('Background transfer planning rewound the moving arm');
    if(step.done)break;
  }
  const before=controls.map(c=>c.angle);
  search.return();
  if(controls.some((c,i)=>Math.abs(c.angle-before[i])>1e-9))throw Error('Cancelling background planning changed the arm');
  console.log('Background transfer planning preserves the current moving arm at every yield and cancellation');
}
{
  const ik=createRobotIK(load('robot'),1,'none');
  ik.collisions.collision=()=>{throw Error('Disabled collision detector was called');};
  const wrist=ik.controls[2],start=wrist.angle;
  for(const offset of [.2,-.2,.2]){
    const pose={baseYaw:ik.baseControl.angle,angles:ik.controls.map(c=>c.angle),error:0,reachable:true};
    pose.angles[2]=start+offset;
    for(let frame=0;frame<1000&&!ik.isEasedSettled(pose);frame++){
      if(!ik.animateEased(pose,1/60))throw Error('Bounded wrist reversal was blocked');
      if(Math.abs(wrist.angle-start)>.2+1e-8)throw Error('Wrist took a full-turn detour');
    }
    if(!ik.isEasedSettled(pose))throw Error('Wrist did not reach its alternating target');
  }
  console.log('Collision disabled: hand04 reverses between targets without full turns');
}
{
  const ik=createRobotIK(load('robot'),1,'held-box-hand03');
  const pose={baseYaw:ik.baseControl.angle+0.4,angles:ik.controls.map(c=>c.angle),error:0,reachable:true};
  const initial=ik.controls.map(c=>c.angle);
  pose.angles[0]+=.15;pose.angles[1]+=.1;pose.angles[2]-=.2;
  const baseStart=ik.baseControl.angle;
  const speeds=[];const dt=0.005;
  for(let frame=0;frame<1000&&!ik.isEasedSettled(pose);frame++){
    const before=ik.baseControl.angle;
    if(!ik.animateEased(pose,dt))throw Error('Eased trajectory rejected a collision-free base turn');
    speeds.push(Math.abs(ik.baseControl.angle-before)/dt);
    const progress=(ik.baseControl.angle-baseStart)/.4;
    for(const [i,distance] of [[0,.15],[1,.1],[2,-.2]])if(Math.abs((ik.controls[i].angle-initial[i])/distance-progress)>1e-6)throw Error("MoveJ joints did not share the same progress");
  }
  const peak=Math.max(...speeds);
  if(!ik.isEasedSettled(pose)||peak>MOTION.baseAngularSpeed+1e-6)throw Error('Easing exceeded speed limit or failed to finish');
  if(speeds[0]>peak*0.01||speeds.at(-1)>peak*0.01)throw Error('Eased movement did not start and finish at rest');
  console.log('MoveJ: all joints share progress, respect speed limits and start/finish smoothly');
}
if(process.env.IK_FACTORY==='1'||process.argv.includes('--scene')){
  const {FactorySimulator}=await import('../.tmp/ik-tests/FactorySimulator.mjs');
  const {SceneInstances}=await import('../.tmp/ik-tests/SceneInstances.mjs');
  const {simulationDelta}=await import('../.tmp/ik-tests/simulationTime.mjs');
  const {DEFAULT_LAYOUT,SIMULATOR_CONFIG:C}=await import('../.tmp/ik-tests/simulatorLayout.mjs');
  const objects=[
    {id:'r1',name:'Robot 1',kind:'robot',x:0,z:-.85,yaw:0},
    {id:'r2',name:'Robot 2',kind:'robot',x:0,z:.85,yaw:Math.PI/6},
    {id:'p1',name:'Pallet 1',kind:'pallet',x:-1.15,z:-.85,yaw:0},
    {id:'p2',name:'Pallet 2',kind:'pallet',x:-1.15,z:.85,yaw:0},
    {id:'belt',name:'Belt',kind:'conveyor',...DEFAULT_LAYOUT.conveyor},
    {id:'amr',name:'AMR',kind:'amr',x:-3,z:-2,yaw:0},
    {id:'dock',name:'Dock',kind:'dock',x:-3,z:2,yaw:0},
  ];
  const cycles=process.argv.includes('--cycles'),deliveries=cycles?6:2;
  const settings=Object.fromEntries(objects.map(o=>[o.id,{speed:cycles?3:1,reach:1.8,capacity:cycles?1:20,spawnInterval:cycles?2:8,enabled:true}]));
  const instances=new SceneInstances(),world=new FactorySimulator(objects,load('box'),load('pallet'),()=>settings,instances),root=new T.Group();root.add(world.root,instances.root,...world.agents.map(a=>a.dispatch.carrier));world.connectInstances();
  const frames=[],models=[];
  for(const robot of world.robots){
    const model=makeRobot(()=>({scene:load('robot',true)}),f=>f(),v=>({current:v}),frame=>frames.push(frame),T.Group,T.Quaternion,T.Vector3,'',m=>createRobotIK(m,C.robotScale,'none'),{current:robot.jobs},(count,status)=>world.robotProgress(robot,count,status),{geometryScale:C.robotScale,transferMode:'base',position:new T.Vector3(robot.object.x,0,robot.object.z),yaw:robot.object.yaw,pickupRadius:C.reach});
    models.push(model);root.add(model);instances.register(model);
  }
  let simultaneous=0,playback=1,heldFrames=0;const renderedPose=new T.Matrix4();
  for(let frame=0;frame<30*(cycles?1500:5000)&&world.dispatched<deliveries;frame++){
    if(frame===300)settings.r1.speed=1.5;
    if(frame===600)playback=2;
    world.advance(simulationDelta(1/30,playback));
    for(let i=0;i<frames.length;i++){
      let time=simulationDelta(1/30,playback,settings[world.robots[i].object.id].speed);
      while(time>1e-9){const dt=Math.min(time,.05);frames[i](null,dt);time-=dt;}
    }
    simultaneous=Math.max(simultaneous,world.robots.filter(r=>r.busy).length);
    instances.sync();
    const claimed=new Set();
    for(let i=0;i<models.length;i++){
      const controller=controllers.get(models[i]);
      if(!['HOME','RETREAT'].includes(controller.phase)){
        const job=world.robots[i].jobs[controller.runtime.index];
        if(job){
          if(claimed.has(job.box))throw Error('Two robots claimed the same box');claimed.add(job.box);
          if(job.box.parent===controller.ik.grip){
            let found=false;
            for(const batch of instances.root.children){const slot=batch.userData.instanceOwners.indexOf(job.box);if(slot<0)continue;found=true;batch.getMatrixAt(slot,renderedPose);if(renderedPose.determinant()===0)throw Error('Carried box instance became invisible during robot motion');}
            if(!found)throw Error('Carried box lost its instance registration');heldFrames++;
          }
        }
      }
    }
    for(const pallet of world.pallets)if(pallet.shipping&&pallet.count!==pallet.slots.length)throw Error('An incomplete pallet was dispatched');
  }
  console.log({placed:world.placed,dispatched:world.dispatched,robotCounts:world.robots.map(r=>r.count),simultaneous,status:world.status});
  if(world.dispatched<deliveries||world.robots.some(r=>r.count<(cycles?2:1))||simultaneous!==2||!heldFrames)throw Error(`Multiple-robot shared-conveyor simulation did not finish: ${world.robots.map((r,i)=>`${r.object.id}: ${r.status}, phase=${controllers.get(models[i]).phase}, busy=${r.busy}, jobs=${r.jobs.length}`).join('; ')}`);
  console.log(`Scene: two independent robots, shared conveyor, exclusive box claims, live speed change and ${deliveries} full pallet deliveries passed`);
  process.exit(0);
}
if(process.env.IK_CUSTOMIZE==='1'){
  const {DEFAULT_LAYOUT,SIMULATOR_CONFIG:C}=await import('../.tmp/ik-tests/simulatorLayout.mjs');
  const {validateLayout,clearanceAt}=await import('../.tmp/ik-tests/layoutNavigation.mjs');
  const {PalletDispatchController}=await import('../.tmp/ik-tests/PalletDispatchController.mjs');
  const layouts=[structuredClone(DEFAULT_LAYOUT)];
  if(process.env.IK_CUSTOMIZE_VARIANTS==='1')layouts.push({...structuredClone(DEFAULT_LAYOUT),robot:{x:.2,z:-.1,yaw:Math.PI/2},pallet:{x:-1.1,z:-.1,yaw:Math.PI/2},conveyor:{x:1.15,z:.1,yaw:.15},amr:{x:-2.6,z:-1.7,yaw:0}});
  for(const [index,layout] of layouts.entries()){
    const errors=validateLayout(layout);if(errors.length)throw Error('Custom layout invalid: '+errors.join('; '));
    const dispatch=new PalletDispatchController(layout),belt=layout.conveyor;
    const {CONVEYOR_PATH}=await import('../.tmp/ik-tests/constants.mjs');
    const path=CONVEYOR_PATH.map(point=>new T.Vector3(point.x-1.06875,point.y,point.z).applyAxisAngle(new T.Vector3(0,1,0),belt.yaw).add(new T.Vector3(belt.x,0,belt.z)));
    let requests=0;
    const world=new ConveyorSimulator(load('box'),load('pallet'),()=>0,{center:new T.Vector3(layout.pallet.x,0,layout.pallet.z),palletYaw:layout.pallet.yaw,path,boxYaw:belt.yaw,robotPosition:new T.Vector3(layout.robot.x,0,layout.robot.z),stackHeight:PRODUCTION_BOX_SIZES[0].y,
      dispatch:(payload,complete)=>{if(world.packer.count!==C.palletCapacity)throw Error('AMR took an incomplete pallet');requests++;dispatch.request(payload,complete);}});
    let frame,ik,status='';
    const model=makeRobot(()=>({scene:load('robot',true)}),f=>f(),v=>({current:v}),f=>{frame=f;},T.Group,T.Quaternion,T.Vector3,'',m=>{ik=createRobotIK(m,C.robotScale,'none');return ik;},{current:world.jobs},(_,next)=>{status=next;},{geometryScale:C.robotScale,transferMode:process.env.IK_TRANSFER_MODE??'base',position:new T.Vector3(layout.robot.x,0,layout.robot.z),yaw:layout.robot.yaw});
    const root=new T.Group();root.add(world.root,dispatch.carrier,model);
    const fps=30;
    for(let i=0;i<fps*3000&&world.completedPallets<1;i++){
      world.advance(1/fps);world.syncJobs();dispatch.advance(1/fps);frame(null,1/fps);
      if(world.placed<C.palletCapacity&&dispatch.phase!=='idle')throw Error('AMR started before loading finished');
      if(dispatch.phase==='blocked')throw Error('AMR dispatch path blocked');
      if(!ik.collisions.isWristAboveHeld())throw Error('Custom robot wrist dropped below box');
      const radius=dispatch.phase==='dispatch'?.82:.4;
      if(clearanceAt(dispatch.carrier.position.x,dispatch.carrier.position.z,'robot',layout)<radius-1e-6||clearanceAt(dispatch.carrier.position.x,dispatch.carrier.position.z,'conveyor',layout)<radius-1e-6)throw Error('Custom AMR collided with equipment');
    }
    console.log({layout:index,placed:world.placed,dispatched:world.completedPallets,requests,status,amr:dispatch.status});
    if(world.completedPallets!==1||world.placed!==C.palletCapacity||requests!==1||world.packer.count!==0)throw Error('Custom packing-to-AMR pipeline did not finish');
  }
  const invalid=structuredClone(DEFAULT_LAYOUT);invalid.pallet.x=-4;
  if(!validateLayout(invalid).some(error=>error.includes('도달 범위')))throw Error('Invalid robot reach was accepted');
  console.log('Simulator: independent placements, reach validation, 20-box loading, full-pallet-only AMR dispatch and empty pallet reset passed');
  process.exit(0);
}
if(process.env.IK_BATCH_ONLY==='1'){
  const demo=makeDemo(url=>({scene:load(url)}),f=>f(),v=>({current:v}),()=>{},T.Box3,T.Group,T.Vector3,'box','pallet');
  const expected=Number(process.env.IK_BATCH_COUNT??fs.readFileSync('src/legacy/robot/RobotDemo.tsx','utf8').match(/BOX_COUNT\s*=\s*(\d+)/)[1]);
  const robotScale=Number(fs.readFileSync('src/legacy/robot/RobotDemo.tsx','utf8').match(/ROBOT_SCALE\s*=\s*([\d.]+)/)[1]);
  if(!Number.isInteger(expected)||expected<=0||demo.transfers.length!==expected)throw Error('Robot demo does not contain the configured box count');
  for(const job of demo.transfers){
    if(new T.Box3().setFromObject(job.box).getSize(new T.Vector3()).distanceTo(PRODUCTION_BOX_SIZES[0])>1e-5)throw Error('Robot and conveyor box dimensions differ');
  }
  const sourcePallet=new T.Box3().setFromObject(demo.root.children[0]).getSize(new T.Vector3());
  if(sourcePallet.distanceTo(new T.Vector3(STREAM_CONFIG.palletWidth,STREAM_CONFIG.palletHeight,STREAM_CONFIG.palletDepth))>1e-5)throw Error('Robot and conveyor pallet dimensions differ');
  let frame,ik,status='',completed=0,placed=0;
  const fps=Number(process.env.IK_FPS??30),transferMode=process.env.IK_TRANSFER_MODE??'base';
  for(const job of demo.transfers)job.onPlace=()=>{
    if(job.box.getWorldPosition(new T.Vector3()).distanceTo(job.destination)>1e-6)throw Error('Batch box missed its destination');
    placed++;
  };
  const model=makeRobot(()=>({scene:load('robot',true)}),f=>f(),v=>({current:v}),f=>{frame=f;},T.Group,T.Quaternion,T.Vector3,'',m=>{ik=createRobotIK(m,robotScale,'none');return ik;},{current:demo.transfers},(count,next)=>{completed=count;if(status!==next&&next.includes('미발견'))console.log(next);status=next;},{geometryScale:robotScale,pickupRadius:ROBOT_PICKING.radius*STREAM_CONFIG.robotScale+STREAM_CONFIG.palletWidth/4,transferMode});
  const root=new T.Group();root.add(demo.root,model);
  for(let i=0;i<fps*2400&&completed<expected;i++){
    frame(null,1/fps);
    if(Math.abs(ik.controls[3].angle-ik.controls[3].initialX)>1e-8)throw Error('Batch hand03 moved');
    if(!ik.collisions.isWristAboveHeld())throw Error('Batch hand04 dropped below cargo');
  }
  console.log({batchPlaced:placed,completed,expected,transferMode,status,
    ...(completed<expected?{start:controllers.get(model).runtime.segmentStart.toArray(),end:controllers.get(model).runtime.segmentEnd.toArray(),point:ik.grip.getWorldPosition(new T.Vector3()).toArray(),angles:ik.controls.map(c=>T.MathUtils.radToDeg(c.angle))}:{}),
  });
  if(placed!==expected||completed!==expected)throw Error('Configured batch transfer did not finish');
  process.exit(0);
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
{
  const closed=await import(new URL('../.tmp/ik-tests/closedChainKinematics.mjs',import.meta.url));
  const chain=closed.createKinematics(numericControls,numericIK.grip,numericModel.getObjectByName('hand04'));
  if(chain.solverPosition(changed).distanceTo(exactTip)>2e-6)throw Error('closed-chain-ik Joint/Link transforms differ from the actual GLB');
  const before=numericIK.grip.getWorldPosition(new T.Vector3());
  const result=finishNumerical(closed.solvePosition(chain.forward,reference,numericLimits,exactTip,false,NUMERICAL_IK.positionTolerance,.1));
  if(!result.converged||chain.forward(result.angles).position.distanceTo(exactTip)>NUMERICAL_IK.positionTolerance)throw Error('closed-chain-ik failed the real transformed hierarchy');
  if(numericIK.grip.getWorldPosition(new T.Vector3()).distanceTo(before)>1e-8)throw Error('closed-chain-ik mutated the visible robot');
  const unreachable=finishNumerical(closed.solvePosition(chain.forward,reference,numericLimits,new T.Vector3(100,100,100),false,NUMERICAL_IK.positionTolerance,.1));
  if(unreachable.converged)throw Error('closed-chain-ik accepted an unreachable target');
  numericParent.scale.setScalar(1.25);numericParent.updateWorldMatrix(true,true);
  const scaled=closed.createKinematics(numericControls,numericIK.grip,numericModel.getObjectByName('hand04'));
  if(scaled.solverPosition(reference).distanceTo(numericIK.grip.getWorldPosition(new T.Vector3()))>2e-6)throw Error('closed-chain-ik lost the parent scale');
  numericParent.scale.setScalar(1);numericParent.updateWorldMatrix(true,true);
  const fixedLimits=numericLimits.map(pair=>[...pair]);fixedLimits[0]=[reference[0],reference[0]];
  const fixedTarget=chain.forward(changed.map((value,i)=>i===0?reference[0]:value)).position;
  const fixed=finishNumerical(closed.solvePosition(chain.forward,reference,fixedLimits,fixedTarget,false,NUMERICAL_IK.positionTolerance,.1));
  if(!fixed.converged||fixed.angles[0]!==reference[0])throw Error('closed-chain-ik moved the fixed base');
  console.log('closed-chain-ik: GLB FK parity, transformed/scaled root, fixed base, reachable/unreachable targets and no scene mutation passed');
}


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
  const heldCargo=new T.Group();heldCargo.add(new T.Mesh(new T.BoxGeometry(.44,.4,.55).translate(0,-.2,0)));
  ik.grip.add(heldCargo);ik.collisions.setHeld(heldCargo);
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
  const heldCargo=new T.Group();ik.grip.add(heldCargo);ik.collisions.setHeld(heldCargo);
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
const FULL_PALLET_RECIPE=[];
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
const randomShapes=new ConveyorSimulator(load('box'),load('pallet'),()=>[0,0.3,0.6,0.9][selection++%4]);
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
const stream=new ConveyorSimulator(load('box'),load('pallet'),random);
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
const exchangeWorld=new ConveyorSimulator(load('box'),load('pallet'),()=>0);
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
const rotationWorld=new ConveyorSimulator(load('box'),load('pallet'),()=>0);
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
const gapWorld=new ConveyorSimulator(load('box'),load('pallet'),()=>.9);gapWorld.packer=makeGapPacking();
const smallItem=gapWorld.items[2];smallItem.size.copy(BOX_SIZES[0]);smallItem.node.children[0].scale.copy(smallItem.size);
gapWorld.items[3].size.copy(BOX_SIZES[3]);gapWorld.items[3].node.children[0].scale.copy(BOX_SIZES[3]);
gapWorld.robotZ=2;gapWorld.advance(0);
if(gapWorld.jobs[0].box!==smallItem.node)throw Error('Belt selection did not favour the box that fills the lower gap');
const levelWorld=new ConveyorSimulator(load('box'),load('pallet'),()=>0);
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
const streamTransferMode=process.env.IK_TRANSFER_MODE??"base";
let lastStatus='';let failures=0;let planningSlices=0,pendingSlices=0,maxPlanningMs=0;
const streamModel=makeRobot(()=>({scene:load('robot',true)}),f=>f(),v=>({current:v}),f=>{streamFrame=f;},T.Group,T.Quaternion,T.Vector3,'',model=>{streamIK=createRobotIK(model,STREAM_CONFIG.robotScale,process.env.IK_INJECT_RECOVERY==='1'?"held-box-hand03":"none");const originalAdvance=streamIK.advancePlan;streamIK.advancePlan=(...args)=>{
  const before=streamIK.controls.map(c=>c.angle),baseAngle=streamIK.baseControl.angle,position=model.position.clone(),start=performance.now();
  const result=originalAdvance(...args);maxPlanningMs=Math.max(maxPlanningMs,performance.now()-start);planningSlices++;
  if(!result){pendingSlices++;if(Math.abs(streamIK.baseControl.angle-baseAngle)>1e-8||model.position.distanceTo(position)>1e-8||streamIK.controls.some((c,i)=>Math.abs(c.angle-before[i])>1e-8))throw Error('Planning yield left speculative pose visible');}
  if(result&&!result.reachable&&failures++<8)console.log('failed-plan',{tip:streamIK.grip.getWorldPosition(new T.Vector3()).toArray(),angles:streamIK.controls.map(control=>T.MathUtils.radToDeg(control.angle)),blockedBy:result.blockedBy,error:result.error});
  return result;
};return streamIK;},{current:stream.jobs},(_,status)=>{if(lastStatus!==status)console.log('stream',status);lastStatus=status;},{geometryScale:STREAM_CONFIG.robotScale,obstacles,transferMode:streamTransferMode});
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
let releaseStartRotation=null,releaseAngle=0,releaseProgressAngle=0;
const pickupJointPoses = new WeakMap();
let rearFrames = 0, alignmentFrames = 0, maximumRearShoulder = -Infinity, maximumShoulderTransfer = 0;
const streamController=controllers.get(streamModel);
const phases=new Set();
let verticalFrames=0, simultaneousFrames=0;
let liftRetraction=0,liftPlanningMovementFrames=0;
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
  const frameBase=streamIK.baseControl.angle;
  const phaseBefore=streamController.phase;
  const tipBefore=streamIK.grip.getWorldPosition(new T.Vector3());
  const planningBefore=planningSlices;
  if(verticalPhase!==phaseBefore){verticalPhase=phaseBefore;verticalOrigin=tipBefore.clone();}
  streamFrame(null,1/streamFps);
  if(streamController.phase==='PRE_PLACE'&&phaseBefore!=='PRE_PLACE'){
    const cargo=stream.items.find(item=>item.state==='held');
    releaseStartRotation=cargo.node.getWorldQuaternion(new T.Quaternion());
    const yaw=stream.jobs[stream.placed].yaw??0;
    releaseAngle=Math.min(...[yaw,yaw+Math.PI].map(angle=>releaseStartRotation.angleTo(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),angle))));
    releaseProgressAngle=0;
  }
  if(phaseBefore==='PRE_PLACE'){
    const cargo=stream.items.find(item=>item.state==='held')??stream.items.filter(item=>item.state==='placed').at(-1);
    const angle=releaseStartRotation.angleTo(cargo.node.getWorldQuaternion(new T.Quaternion()));
    if(angle>releaseAngle+1e-6||angle<releaseProgressAngle-1e-6)throw Error('Hovering box did not take its nearest equivalent rotation');
    if(angle-releaseProgressAngle>ROBOT_PICKING.releaseAngularSpeed/streamFps+1e-6)throw Error('Hovering box rotated too quickly');
    releaseProgressAngle=angle;
  }
  if(['PLACE','RELEASE'].includes(phaseBefore)){
    const cargo=stream.items.find(item=>item.state==='held')??stream.items.filter(item=>item.state==='placed').at(-1);
    if(Math.abs(releaseStartRotation.angleTo(cargo.node.getWorldQuaternion(new T.Quaternion()))-releaseAngle)>1e-6)throw Error('Box changed orientation during lowering or release');
  }
  phases.add(streamController.phase);
  if(phaseBefore==="TRANSIT"&&Math.abs(streamIK.baseControl.angle-frameBase)>1e-8&&streamIK.controls.some((c,j)=>Math.abs(c.angle-frameAngles[j])>1e-8))simultaneousFrames++;
  if(phaseBefore==='LIFT'&&streamTransferMode==='shoulder'){
    const tip=streamIK.grip.getWorldPosition(new T.Vector3());
    const offset=Math.hypot(tip.x-verticalOrigin.x,tip.z-verticalOrigin.z);
    liftRetraction=Math.max(liftRetraction,offset);
    if(offset>ROBOT_PICKING.liftRearwardDistance+MOTION.contactTolerance)throw Error('Lift exceeded its rearward waypoint');
    if(planningSlices>planningBefore&&tip.distanceTo(tipBefore)>1e-6)liftPlanningMovementFrames++;
  }
  if([...(streamTransferMode==='shoulder'?[]:['LIFT']),"PLACE","RETREAT"].includes(phaseBefore)&&phaseBefore===streamController.phase){
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
  const wristTravel=streamIK.controls[2];
  if(wristTravel.angle<wristTravel.min-1e-8||wristTravel.angle>wristTravel.max+1e-8)throw Error('hand04 left its fixed travel range');
  if (!streamIK.collisions.isWristAboveHeld()) throw Error('hand04 dropped below the lifted box');
  for(const item of stream.items.filter(item=>item.state==='held')){
    if(item.node.parent!==streamIK.grip)continue;
    const saved=attachmentPoses.get(item.node);
    if(!saved)attachmentPoses.set(item.node,{rotation:item.node.quaternion.clone(),position:item.node.position.clone()});
    else if(!['PRE_PLACE','PLACE','RELEASE'].includes(phaseBefore)&&(item.node.quaternion.angleTo(saved.rotation)>1e-6||item.node.position.distanceTo(saved.position)>1e-8))throw Error("Held cargo lost its rigid attachment during transport");
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
for(const phase of ['HOME','PRE_GRASP','GRASP','ATTACH','LIFT','TRANSIT','PRE_PLACE','PLACE','RELEASE','RETREAT',...(streamTransferMode==='shoulder'?['SHOULDER_TRANSFER','ALIGN_BASE']:[])])if(!phases.has(phase))throw Error('Missing waypoint phase '+phase);
if(verticalFrames===0||streamController.phase!=='HOME')throw Error('Vertical retreat did not finish');
if(streamTransferMode==='shoulder'){
  if(liftRetraction<ROBOT_PICKING.liftRearwardDistance*.8||liftPlanningMovementFrames===0)throw Error('Lift did not retract while planning the rear transfer');
  if(rearFrames===0||alignmentFrames===0||maximumShoulderTransfer<.2)throw Error('Shoulder-first option was not exercised');
}else{
  if(phases.has('SHOULDER_TRANSFER')||phases.has('ALIGN_BASE'))throw Error('Default MoveJ forced sequential joint phases');
  if(simultaneousFrames===0)throw Error('Base rotation was not synchronized with arm motion');
}
console.log({transferMode:streamTransferMode,simultaneousFrames});
if(maximumBaseYaw-minimumBaseYaw<.1)throw Error('Continuous pickup did not use hand00 yaw');
console.log('Continuous spline: '+stream.placed+' T11 boxes at '+streamFps+'fps; closed-chain-ik, bounded hand04 travel and yellow-target placement verified');


