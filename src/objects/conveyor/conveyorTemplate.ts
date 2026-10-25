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
import type { ConveyorRole, ConveyorTurn } from "@/types/layout";
import { PALLET_CONVEYOR } from "@/constants/palletConveyor";
import { CONVEYOR_LAYOUT as C } from "@/constants/conveyorLayoutConfig";
import { beltLength, beltLocalPoint } from "@/domain/conveyor/conveyorLayout";

const templates = new Map<string, Group>();
const bodyMaterial = new MeshStandardMaterial({ color: "#475569" });
const stripeMaterial = new MeshStandardMaterial({ color: "#fbbf24" });
const legMaterial = new MeshStandardMaterial({ color: "#334155" });
const accentMaterial = new MeshStandardMaterial({ color: PALLET_CONVEYOR.accent, emissive: PALLET_CONVEYOR.accent, emissiveIntensity: 0.35 });
const padMaterial = new MeshStandardMaterial({ color: PALLET_CONVEYOR.accent, transparent: true, opacity: 0.45 });
/** Flat chevron pointing along +z (belt flow), `size` m wide. */
function chevron(size: number) {
  const shape = new Shape(), w = size / 2, t = size * 0.22;
  shape.moveTo(-w, 0);
  shape.lineTo(0, w * 0.8);
  shape.lineTo(w, 0);
  shape.lineTo(w, -t);
  shape.lineTo(0, w * 0.8 - t);
  shape.lineTo(-w, -t);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
  // Shape XY -> floor XZ (shape +Y = belt +Z).
  geometry.rotateX(Math.PI / 2);
  return geometry;
}
/**
 * #02dfef markings on a straight rail.glb belt (the rail itself is untouched): inbound (입하) = chevrons
 * along both side frames; outbound (출하) = large pallet chevrons on the belt, a side stripe and the AMR
 * transfer pad in front of the belt start.
 */
function roleAccents(role: ConveyorRole, template: Group) {
  const half = C.length / 2, top = C.height + 0.008;
  if (role === "inbound") {
    const geometry = chevron(0.32);
    for (let z = -half + 1.5; z < half - 0.5; z += 3)
      for (const side of [-1, 1]) {
        const mark = new Mesh(geometry, accentMaterial);
        mark.position.set(side * (C.beltWidth / 2 + (C.width - C.beltWidth) / 4), top, z);
        template.add(mark);
      }
    return;
  }
  if (role !== "outbound") return;
  const geometry = chevron(C.beltWidth * 0.55);
  for (let z = -half + 2; z < half - 1; z += 4) {
    const mark = new Mesh(geometry, accentMaterial);
    mark.position.set(0, top, z);
    template.add(mark);
  }
  for (const side of [-1, 1]) {
    const stripe = new Mesh(new BoxGeometry(0.06, 0.02, C.length * 0.96), accentMaterial);
    stripe.position.set(side * (C.width / 2 - 0.03), top, 0);
    template.add(stripe);
  }
  // AMR docking / transfer pad (on the floor, in front of the belt start).
  const pad = new Mesh(new BoxGeometry(C.width, 0.006, 0.12), padMaterial);
  pad.position.set(0, 0.004, -half - PALLET_CONVEYOR.transferOffset + 1.25);
  template.add(pad);
}
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
export function conveyorTemplate(turn: ConveyorTurn = "straight", rail?: Object3D, role: ConveyorRole = "box") {
  const accented = turn === "straight" && (role === "inbound" || role === "outbound");
  const key = `${turn === "straight" && rail ? "rail" : turn}${accented ? `:${role}` : ""}`;
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
    if (accented) roleAccents(role, template);
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
  if (accented) roleAccents(role, template);
  templates.set(key, template);
  return template;
}
