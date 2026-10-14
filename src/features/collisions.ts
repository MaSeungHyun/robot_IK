import { COLLISION, MOTION } from "./constants";
import { Box3, DoubleSide, Group, Matrix4, Mesh, Quaternion, Ray, Vector3, type Object3D } from "three";
import { OBB } from "three/addons/math/OBB.js";
import { MeshBVH } from "three-mesh-bvh";

export type CollisionContext = { boxes: Group[]; active: Group; carrying: boolean; releasing?: boolean; carryRotation?: Quaternion };
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
  const insideRay = new Ray(new Vector3(), new Vector3(0.937,0.231,0.263).normalize());

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
    c.world.halfSize.x = Math.max(0, c.world.halfSize.x - COLLISION.restingTolerance);
    c.world.halfSize.y = Math.max(0, c.world.halfSize.y - COLLISION.restingTolerance);
    c.world.halfSize.z = Math.max(0, c.world.halfSize.z - COLLISION.restingTolerance);
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
    lastHit = null;
    if (!context) return null;
    syncHeld();
    robotParts.forEach(update);
    const boxes = context.boxes.map(box => { const c = collider(box); update(c); return c; });
    const active = collider(context.active);
    update(active);
    if (context.carrying && bounds.copy(active.local).applyMatrix4(active.node.matrixWorld).min.y < COLLISION.floorClearance) return lastHit = "held box / floor";
    for (const part of robotParts) for (const box of boxes) {
      const heldCargo= context.carrying && box.node===context.active;
      if(!COLLISION.armBoxCollisions&&/^hand0[1-5]$/.test(part.part)&&box.node.userData.collisionRole!=="pallet"
        &&!(heldCargo&&COLLISION.carriedRobotCollisions))continue;
      if (!part.world.intersectsOBB(box.world)) continue;
      // Exact robot triangles against the cargo volume after a cheap OBB
      // broad phase. Empty space in large arm bounds is not an obstacle.
      boxToMesh.copy(part.node.matrixWorld).invert().multiply(box.node.matrixWorld);
      narrowBox.copy(box.local).expandByScalar(-COLLISION.restingTolerance);
      if (!part.bvh!.intersectsBox(narrowBox, boxToMesh)) {
        // A cargo volume wholly inside a closed robot mesh may not cross
        // any triangles. Odd ray parity detects that containment case.
        narrowBox.getCenter(insideRay.origin).applyMatrix4(boxToMesh);
        const hits = part.bvh!.raycast(insideRay, DoubleSide).sort((a,b)=>a.distance-b.distance);
        let crossings=0, lastDistance=-Infinity;
        for (const hit of hits) if (hit.distance-lastDistance>COLLISION.rayMergeTolerance) {crossings++;lastDistance=hit.distance;}
        if (crossings % 2 === 0) continue;
      }
      // Only the end gripper can make the intended top-face pickup contact.
      if (box.node === context.active && part.part === "hand05") {
        grip.getWorldPosition(point);
        point.applyMatrix4(inverse.copy(box.node.matrixWorld).invert());
        const onTopFace = Math.abs(point.y-box.local.max.y)<COLLISION.graspTopTolerance
          && point.x>box.local.min.x+COLLISION.graspEdgeInset && point.x<box.local.max.x-COLLISION.graspEdgeInset
          && point.z>box.local.min.z+COLLISION.graspEdgeInset && point.z<box.local.max.z-COLLISION.graspEdgeInset;
        const releasingAbove = context.releasing && point.y >= box.local.max.y - COLLISION.graspTopTolerance
          && point.x > box.local.min.x && point.x < box.local.max.x
          && point.z > box.local.min.z && point.z < box.local.max.z;
        if (onTopFace || releasingAbove) continue;
      }
      const label=heldCargo?"운반 박스":box.node.userData.collisionRole==="pallet"?"팔레트":box.node.userData.collisionRole==="placed"?"적재된 박스":box.node.userData.collisionRole==="conveyor"?"컨베이어 박스":"박스";
      return lastHit = heldCargo
        ? `운반 박스와 ${part.part || "로봇 몸체"} 충돌`
        : `${part.part || "robot"} / ${label} #${context.boxes.indexOf(box.node as Group)}`;
    }
    if (context.carrying) for (const box of boxes) {
      if(!COLLISION.carriedConveyorBoxCollisions&&box.node.userData.collisionRole==="conveyor")continue;
      if (box.node !== context.active && active.world.intersectsOBB(box.world)) {
        const role=box.node.userData.collisionRole;
        const label=role==="pallet"?"팔레트":role==="placed"?"적재된 박스":role==="conveyor"?"컨베이어 박스":"장애물";
        const center=box.world.center;
        return lastHit = `운반 박스 / ${label} · 대상 중심 X${center.x.toFixed(2)} Y${center.y.toFixed(2)} Z${center.z.toFixed(2)}m`;
      }
    }
    return null;
  }
  function orientCargo(target: Quaternion, dt: number): "ready" | "moving" | "blocked" {
    if (!context?.carrying || context.active.parent !== grip) return "ready";
    const original = context.active.quaternion.clone();
    const angle = original.angleTo(target);
    if (angle < COLLISION.rotationTolerance) { context.carryRotation = target; syncHeld(); return "ready"; }
    const step = Math.min(angle, dt * MOTION.angularSpeed);
    const next = original.clone().slerp(target, step / angle);
    // Check intermediate payload rotations too, not just the rendered frame.
    const samples = Math.max(1, Math.ceil(step / COLLISION.rotationStep));
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
  function liftHeight(destinationTop:number) {
    if(!context)return destinationTop+MOTION.liftClearance;
    const active=collider(context.active);
    let highest=destinationTop;
    for(const box of context.boxes)if(box!==context.active){
      if(!COLLISION.carriedConveyorBoxCollisions&&box.userData.collisionRole==="conveyor")continue;
      const c=collider(box);box.updateWorldMatrix(true,false);
      highest=Math.max(highest,bounds.copy(c.local).applyMatrix4(box.matrixWorld).max.y);
    }
    context.active.updateWorldMatrix(true,true);
    const height=bounds.copy(active.local).applyMatrix4(context.active.matrixWorld).getSize(new Vector3()).y;
    // A distant tall stack must not force every pickup beyond arm reach.
    // The planner/preflight still rejects obstacles below this capped route.
    return Math.max(destinationTop,Math.min(MOTION.maxTransportHeight,highest+height+COLLISION.cargoLiftClearance));
  }
  function placementClear(destination:Vector3, yaw:number, hoverY:number, toolRotation:Quaternion) {
    if(!context?.carrying||context.active.parent!==grip)return true;
    const active=collider(context.active);
    const cargoPose=new Matrix4().compose(destination,new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw),context.active.getWorldScale(new Vector3()));
    const cargoSweep=active.local.clone().applyMatrix4(cargoPose).expandByScalar(-COLLISION.restingTolerance);
    const descent=Math.max(0,hoverY-destination.y);cargoSweep.max.y+=descent;
    // Wrist pose is solved by IK. A fixed-pose sweep cannot reject every
    // alternative shoulder/elbow/wrist orientation at this footprint.
    void toolRotation;
    for(const box of context.boxes){
      if(box===context.active)continue;
      if(!COLLISION.carriedConveyorBoxCollisions&&box.userData.collisionRole==="conveyor")continue;
      const other=collider(box);box.updateWorldMatrix(true,false);
      const obstacle=other.local.clone().applyMatrix4(box.matrixWorld).expandByScalar(-COLLISION.restingTolerance);
      if(cargoSweep.intersectsBox(obstacle))return false;

    }
    return true;
  }
  return { setContext, syncHeld, collision, orientCargo, liftHeight, placementClear, get lastHit() { return lastHit; } };
}
