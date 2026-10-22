import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import * as T from "three";

const output = path.resolve(".tmp/render-tests");
fs.mkdirSync(output, { recursive: true });
for (const [name, file] of Object.entries({
  viewport: "src/constants/viewport.ts",
  SceneInstances: "src/viewport/instancing/SceneInstances.ts",
})) {
  const source = fs.readFileSync(file, "utf8").replaceAll("@/constants/viewport", "./viewport.mjs");
  fs.writeFileSync(path.join(output, `${name}.mjs`), ts.transpile(source, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  }));
}
const { SceneInstances } = await import("../.tmp/render-tests/SceneInstances.mjs");
const geometry = new T.BoxGeometry();
const material = new T.MeshBasicMaterial();
const model = (x, isStatic = false, noCastShadow = false) => {
  const owner = new T.Group();
  owner.position.x = x;
  owner.userData.instanceStatic = isStatic;
  const mesh = new T.Mesh(geometry, material);
  mesh.userData.noCastShadow = noCastShadow;
  owner.add(mesh);
  return owner;
};
const frustum = (x) => {
  const camera = new T.PerspectiveCamera(50, 1, 0.1, 30);
  camera.position.set(x, 0, 5);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld();
  return new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
};

// Static sectors can be rejected independently. Their visibility is never set from the main
// camera: a sector outside that camera may still be required by a shadow-camera pass.
{
  const instances = new SceneInstances();
  const scene = new T.Group();
  const near = model(0, true), far = model(250, true);
  scene.add(instances.root, near, far);
  instances.register(near); instances.register(far); instances.sync(); scene.updateMatrixWorld(true);
  assert.equal(instances.root.children.length, 2);
  const nearBatch = instances.root.children.find((mesh) => mesh.userData.instanceOwners.includes(near));
  const farBatch = instances.root.children.find((mesh) => mesh.userData.instanceOwners.includes(far));
  assert.ok(nearBatch.frustumCulled && farBatch.frustumCulled);
  assert.ok(frustum(0).intersectsObject(nearBatch));
  assert.equal(frustum(0).intersectsObject(farBatch), false);
  assert.ok(frustum(250).intersectsObject(farBatch));
  assert.ok(farBatch.visible);
  const versions = instances.root.children.map((mesh) => mesh.instanceMatrix.version);
  const sphere = nearBatch.boundingSphere;
  instances.sync();
  assert.deepEqual(instances.root.children.map((mesh) => mesh.instanceMatrix.version), versions);
  assert.equal(nearBatch.boundingSphere, sphere);
  near.position.x = 3; instances.sync(); scene.updateMatrixWorld(true);
  assert.ok(nearBatch.boundingSphere.containsPoint(new T.Vector3(3, 0, 0)));
  const hits = [];
  nearBatch.raycast(new T.Raycaster(new T.Vector3(3, 0, 5), new T.Vector3(0, 0, -1)), hits);
  assert.ok(hits.length > 0);
  assert.equal(nearBatch.userData.instanceOwners[hits[0].instanceId], near);
  far.visible = false; instances.sync(); scene.updateMatrixWorld(true);
  assert.equal(frustum(0).intersectsObject(farBatch), false, "hidden instances must not pull distant bounds back to the origin");
  instances.dispose();
  assert.ok(near.children[0].visible && far.children[0].visible);
}

// Moving and attached equipment refresh their bounds in the same sync as their GPU matrices.
{
  const instances = new SceneInstances(), scene = new T.Group(), moving = model(0);
  const carrier = new T.Group();
  scene.add(instances.root, moving, carrier);
  instances.register(moving); instances.sync(); scene.updateMatrixWorld(true);
  const mesh = instances.root.children[0];
  assert.ok(frustum(0).intersectsObject(mesh));
  carrier.attach(moving); carrier.position.x = 250;
  instances.sync(); scene.updateMatrixWorld(true);
  assert.equal(frustum(0).intersectsObject(mesh), false);
  assert.ok(frustum(250).intersectsObject(mesh));
  carrier.position.x = 0; instances.sync(); scene.updateMatrixWorld(true);
  assert.ok(frustum(0).intersectsObject(mesh));
  instances.unregister(moving); instances.sync();
  assert.equal(instances.root.children.length, 0);
  instances.dispose();
}

// Shadow policy belongs in the batch key even when geometry and material are shared.
{
  const instances = new SceneInstances();
  const casting = model(0), receiving = model(0, false, true);
  instances.register(casting); instances.register(receiving); instances.sync();
  assert.equal(instances.root.children.length, 2);
  assert.equal(instances.root.children.find((mesh) => mesh.userData.instanceOwners.includes(casting)).castShadow, true);
  assert.equal(instances.root.children.find((mesh) => mesh.userData.instanceOwners.includes(receiving)).castShadow, false);
  instances.dispose();
}
geometry.dispose(); material.dispose();
console.log("Rendering: static sector culling, independent camera passes, unchanged-frame uploads, moved/attached bounds, picking, hidden bounds, shadow policy and cleanup passed.");
