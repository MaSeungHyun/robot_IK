import {
  Box3,
  BoxGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  Vector3,
  type Object3D,
} from "three";
import type { ConveyorTurn } from "@/types/layout";
import { CONVEYOR_LAYOUT as C } from "@/constants/conveyorLayoutConfig";
import { beltLength, beltLocalPoint } from "@/domain/conveyor/conveyorLayout";

const templates = new Map<string, Group>();
const bodyMaterial = new MeshStandardMaterial({ color: "#475569" });
const stripeMaterial = new MeshStandardMaterial({ color: "#fbbf24" });
const legMaterial = new MeshStandardMaterial({ color: "#334155" });
// Turns (no rail.glb piece) are a procedural ribbon at the rail's width with the belt at the rail's belt height.
const bodyDepth = 0.025;
const legGeometry = new BoxGeometry(C.beltWidth * 0.7, C.height - bodyDepth, 0.08);
function ribbon(turn: ConveyorTurn, width: number, depth: number) {
  const length = beltLength({ x: 0, z: 0, yaw: 0, conveyorTurn: turn });
  const samples = Array.from({ length: C.samples + 1 }, (_, i) =>
    beltLocalPoint({ conveyorTurn: turn }, (length * i) / C.samples),
  );
  const edge = (side: number) =>
    samples.map((p) => ({
      x: p.x + ((Math.cos(p.yaw) * width) / 2) * side,
      y: -(p.z - ((Math.sin(p.yaw) * width) / 2) * side),
    }));
  const outline = [...edge(1), ...edge(-1).reverse()],
    shape = new Shape();
  outline.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, p.y);
    else shape.lineTo(p.x, p.y);
  });
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
}
/** Immutable shared geometry/materials: clones only retain independent transforms. */
export function conveyorTemplate(turn: ConveyorTurn = "straight", rail?: Object3D) {
  const key = turn === "straight" && rail ? "rail" : turn;
  let template = templates.get(key);
  if (template) return template;
  template = new Group();
  if (turn === "straight" && rail) {
    // rail.glb as authored: only its pivot is moved so the mesh is centred on the belt path with its bottom on the floor.
    const asset = rail.clone(true);
    for (const child of asset.children) child.position.set(0, 0, 0);
    const bounds = new Box3().setFromObject(asset), center = bounds.getCenter(new Vector3());
    asset.position.set(-center.x, -bounds.min.y, -center.z);
    template.add(asset);
    templates.set(key, template);
    return template;
  }
  const body = new Mesh(ribbon(turn, C.width, bodyDepth), bodyMaterial);
  body.rotation.x = -Math.PI / 2;
  body.position.y = C.height - bodyDepth;
  template.add(body);
  const stripe = new Mesh(ribbon(turn, C.beltWidth, 0.001), stripeMaterial);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.y = C.height;
  template.add(stripe);
  const length = beltLength({ x: 0, z: 0, yaw: 0, conveyorTurn: turn });
  for (const t of [0.15, 0.85]) {
    const p = beltLocalPoint({ conveyorTurn: turn }, length * t),
      leg = new Mesh(legGeometry, legMaterial);
    leg.position.set(p.x, (C.height - bodyDepth) / 2, p.z);
    leg.rotation.y = p.yaw;
    template.add(leg);
  }
  templates.set(turn, template);
  return template;
}
