import { Box3, DoubleSide, Matrix4, Mesh, Ray, Vector3, type Group, type Object3D } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { COLLISION } from "../../constants/simulation";
import { isWristAboveBox } from "./picking";

/** The only production collision pair: the held box volume versus hand03 triangles. */
export function createHeldBoxCollision(model: Group, grip: Object3D) {
  const wrist = model.getObjectByName("hand04");
  if (!wrist) throw new Error("Robot joint missing: hand04");
  const parts: { mesh: Mesh; bvh: MeshBVH }[] = [];
  model.traverse(node => {
    if (!(node instanceof Mesh)) return;
    let owner: Object3D | null = node;
    while (owner && !/^hand0[0-5]$/.test(owner.name)) owner = owner.parent;
    if (owner?.name === "hand03") parts.push({ mesh: node, bvh: new MeshBVH(node.geometry) });
  });
  let held: Group | null = null;
  let lastHit: string | null = null;
  const local = new Box3(), bounds = new Box3(), relative = new Matrix4(), inverse = new Matrix4();
  const boxToMesh = new Matrix4();
  const ray = new Ray(new Vector3(), new Vector3(0.937,0.231,0.263).normalize());

  function setHeld(box: Group | null): void {
    held = box;
    local.makeEmpty();
    if (!box) return;
    box.updateWorldMatrix(true, true);
    inverse.copy(box.matrixWorld).invert();
    box.traverse(node => {
      if (!(node instanceof Mesh)) return;
      node.geometry.computeBoundingBox();
      relative.multiplyMatrices(inverse, node.matrixWorld);
      local.union(bounds.copy(node.geometry.boundingBox!).applyMatrix4(relative));
    });
    local.expandByScalar(-COLLISION.restingTolerance);
  }

  function collision(): string | null {
    lastHit = null;
    if (!held || held.parent !== grip || local.isEmpty()) return null;
    model.updateWorldMatrix(true, true);
    for (const part of parts) {
      boxToMesh.copy(part.mesh.matrixWorld).invert().multiply(held.matrixWorld);
      let hit = part.bvh.intersectsBox(local, boxToMesh);
      if (!hit) {
        local.getCenter(ray.origin).applyMatrix4(boxToMesh);
        const hits = part.bvh.raycast(ray, DoubleSide).sort((a,b) => a.distance-b.distance);
        let crossings = 0, previous = -Infinity;
        for (const intersection of hits) if (intersection.distance-previous > COLLISION.rayMergeTolerance) {
          crossings++; previous = intersection.distance;
        }
        hit = crossings % 2 === 1;
      }
      if (hit) return lastHit = "들어 올린 박스 / hand03 충돌";
    }
    return null;
  }

  return {
    setHeld, collision, syncHeld: () => {},
    get holding() { return Boolean(held && held.parent === grip); },
    isWristAboveHeld: () => !held || held.parent !== grip || isWristAboveBox(wrist, held),
    get lastHit() { return lastHit; },
  };
}
