import {
  BoxGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
} from "three";
import type { ConveyorTurn } from "@/types/layout";
import { CONVEYOR_LAYOUT as C } from "@/constants/conveyorLayoutConfig";
import { beltLength, beltLocalPoint } from "@/utils/conveyor/conveyorLayout";

const templates = new Map<ConveyorTurn, Group>();
const bodyMaterial = new MeshStandardMaterial({ color: "#475569" });
const stripeMaterial = new MeshStandardMaterial({ color: "#fbbf24" });
const legMaterial = new MeshStandardMaterial({ color: "#334155" });
const legGeometry = new BoxGeometry(0.24, 0.22, 0.08);
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
export function conveyorTemplate(turn: ConveyorTurn = "straight") {
  let template = templates.get(turn);
  if (template) return template;
  template = new Group();
  const body = new Mesh(ribbon(turn, C.width, 0.025), bodyMaterial);
  body.rotation.x = -Math.PI / 2;
  body.position.y = 0.225;
  template.add(body);
  const stripe = new Mesh(ribbon(turn, 0.014, 0.001), stripeMaterial);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.y = 0.253;
  template.add(stripe);
  const length = beltLength({ x: 0, z: 0, yaw: 0, conveyorTurn: turn });
  for (const t of [0.15, 0.85]) {
    const p = beltLocalPoint({ conveyorTurn: turn }, length * t),
      leg = new Mesh(legGeometry, legMaterial);
    leg.position.set(p.x, 0.11, p.z);
    leg.rotation.y = p.yaw;
    template.add(leg);
  }
  templates.set(turn, template);
  return template;
}
