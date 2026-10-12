import { Box3, Group, Matrix4, Mesh, Quaternion, Vector3, type Object3D } from "three";
import { OBB } from "three/addons/math/OBB.js";
import { MeshBVH } from "three-mesh-bvh";

export type CollisionContext = { boxes: Group[]; active: Group; carrying: boolean; carryRotation?: Quaternion };
type Collider = { node: Object3D; local: Box3; world: OBB; part: string; bvh?: MeshBVH };

export function createCollisionWorld(robot: Group, grip: Object3D) {
  const robotParts: Collider[] = [];
  robot.traverse(node => {
    if (!(node instanceof Mesh)) return;
    node.geometry.computeBoundingBox();
    let part: Object3D = node;
    while (part.parent && !/^hand0[1-5]$|^base/.test(part.name)) part = part.parent;
    robotParts.push({ node, local: node.geometry.boundingBox!.clone(), world: new OBB(), part: part.name, bvh: new MeshBVH(node.geometry) });
  });
  const cargo = new WeakMap<Group, Collider>();
  let context: CollisionContext | null = null;
  let lastHit: string | null = null;
  const inverse = new Matrix4();
  const relative = new Matrix4();
  const bounds = new Box3();
  const quaternion = new Quaternion();
  const heldRotation = new Quaternion();
  const point = new Vector3();
  const narrowBox = new Box3();
  const boxToMesh = new Matrix4();

  function collider(box: Group) {
    let cached = cargo.get(box);
    if (!cached) {
      box.updateWorldMatrix(true, true);
      inverse.copy(box.matrixWorld).invert();
      const local = new Box3();
      box.traverse(node => {
        if (!(node instanceof Mesh)) return;
        node.geometry.computeBoundingBox();
        relative.multiplyMatrices(inverse, node.matrixWorld);
        local.union(bounds.copy(node.geometry.boundingBox!).applyMatrix4(relative));
      });
      cached = { node: box, local, world: new OBB(), part: "cargo" };
      cargo.set(box, cached);
    }
    return cached;
  }
  function update(c: Collider) {
    c.node.updateWorldMatrix(true, false);
    c.world.fromBox3(c.local);
    c.world.center.set(0,0,0);
    c.world.applyMatrix4(c.node.matrixWorld);
    c.local.getCenter(c.world.center).applyMatrix4(c.node.matrixWorld);
    // Allow physical resting contact; only actual penetration is rejected.
    c.world.halfSize.x = Math.max(0, c.world.halfSize.x - 0.002);
    c.world.halfSize.y = Math.max(0, c.world.halfSize.y - 0.002);
    c.world.halfSize.z = Math.max(0, c.world.halfSize.z - 0.002);
  }
  function setContext(next: CollisionContext) {
    context = next;
    next.boxes.forEach(collider);
    if (next.carrying) next.active.getWorldQuaternion(heldRotation);
  }
  function syncHeld() {
    if (!context?.carrying || context.active.parent !== grip) return;
    if (context.carryRotation) context.active.quaternion.copy(context.carryRotation);
    else {
      grip.getWorldQuaternion(quaternion).invert();
      context.active.quaternion.copy(quaternion).multiply(heldRotation);
    }
    context.active.updateWorldMatrix(true, true);
  }
  function collision(): string | null {
    if (!context) return null;
    syncHeld();
    robotParts.forEach(update);
    const boxes = context.boxes.map(box => { const c = collider(box); update(c); return c; });
    const active = collider(context.active);
    if (context.carrying && bounds.copy(active.local).applyMatrix4(active.node.matrixWorld).min.y < 0.015) return lastHit = "held box / floor";
    for (const part of robotParts) for (const box of boxes) {
      if (!part.world.intersectsOBB(box.world)) continue;
      // Exact robot triangles against the cargo volume after a cheap OBB
      // broad phase. Empty space in large arm bounds is not an obstacle.
      boxToMesh.copy(part.node.matrixWorld).invert().multiply(box.node.matrixWorld);
      narrowBox.copy(box.local).expandByScalar(-0.002);
      if (!part.bvh!.intersectsBox(narrowBox, boxToMesh)) continue;
      // Only the end gripper can make the intended top-face pickup contact.
      if (box.node === context.active && part.part === "hand05") {
        grip.getWorldPosition(point);
        const top = new Vector3(0, box.local.max.y, 0).applyMatrix4(box.node.matrixWorld);
        if (context.carrying || point.distanceTo(top) < 0.055) continue;
      }
      return lastHit = `${part.part || "robot"} / box ${context.boxes.indexOf(box.node as Group)}`;
    }
    if (context.carrying) for (const box of boxes) {
      if (box.node !== context.active && active.world.intersectsOBB(box.world)) return lastHit = "held box / placed box";
    }
    return null;
  }
  function orientCargo(target: Quaternion, dt: number): "ready" | "moving" | "blocked" {
    if (!context?.carrying || context.active.parent !== grip) return "ready";
    const original = context.active.quaternion.clone();
    const angle = original.angleTo(target);
    if (angle < 0.001) { context.carryRotation = target; syncHeld(); return "ready"; }
    const step = Math.min(angle, dt * 1.8);
    const next = original.clone().slerp(target, step / angle);
    // Check intermediate payload rotations too, not just the rendered frame.
    const samples = Math.max(1, Math.ceil(step / 0.015));
    for (let i=1;i<=samples;i++) {
      context.carryRotation = original.clone().slerp(next, i / samples);
      if (collision()) {
        context.carryRotation = original;
        syncHeld();
        return "blocked";
      }
    }
    context.carryRotation = next;
    syncHeld();
    return step === angle ? "ready" : "moving";
  }
  return { setContext, syncHeld, collision, orientCargo, get lastHit() { return lastHit; } };
}
