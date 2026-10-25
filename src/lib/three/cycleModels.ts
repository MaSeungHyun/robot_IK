import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { CylinderGeometry } from "three";
import { AGV_MODEL, AMR_DECK, CYCLE_ACCENT, RACK_M_MODEL, ROLLER_TOP_MODEL } from "@/constants/cycle";

/**
 * Procedural placeholder models for the pallet cycle (AGV, Rack_m). Real-world sizes come from
 * constants/cycle.ts. Each model is a Group named like the future GLB root ("AGV", "Rack_m") with
 * its origin at the floor centre and forward = local +Z; moving parts are named child groups
 * ("AGV.Lift") so a GLB with the same node names can replace the procedural meshes later.
 * Geometry and materials are shared module singletons (never disposed by a single user).
 */
const materials = {
  body: new MeshStandardMaterial({ color: "#2f3540", roughness: 0.6, metalness: 0.3 }),
  frame: new MeshStandardMaterial({ color: "#5b6573", roughness: 0.5, metalness: 0.6 }),
  deck: new MeshStandardMaterial({ color: "#8a929c", roughness: 0.7, metalness: 0.2 }),
  accent: new MeshStandardMaterial({ color: CYCLE_ACCENT, emissive: CYCLE_ACCENT, emissiveIntensity: 0.35, roughness: 0.4 }),
};
const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);

function part(geometry: BoxGeometry, material: MeshStandardMaterial, x: number, y: number, z: number) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Low-profile lifting AGV; `lift` (AGV.Lift) is the plate raised by AGV_MODEL.liftStroke. */
export function createAgvModel() {
  const { width, length, height } = AGV_MODEL;
  const root = new Group();
  root.name = "AGV";
  const bodyH = height - 0.04;
  root.add(part(box(width, bodyH, length), materials.body, 0, bodyH / 2 + 0.02, 0));
  // Accent bumpers front / rear and a light strip on each side.
  root.add(part(box(width * 0.9, 0.05, 0.03), materials.accent, 0, bodyH * 0.55, length / 2 + 0.01));
  root.add(part(box(width * 0.9, 0.05, 0.03), materials.accent, 0, bodyH * 0.55, -length / 2 - 0.01));
  root.add(part(box(0.02, 0.03, length * 0.8), materials.accent, width / 2 + 0.005, bodyH * 0.7, 0));
  root.add(part(box(0.02, 0.03, length * 0.8), materials.accent, -width / 2 - 0.005, bodyH * 0.7, 0));
  const lift = new Group();
  lift.name = "AGV.Lift";
  lift.position.y = bodyH + 0.02;
  lift.add(part(box(width * 0.7, 0.02, width * 0.7), materials.deck, 0, 0.01, 0));
  lift.add(part(box(width * 0.3, 0.021, 0.04), materials.accent, 0, 0.011, 0));
  root.add(lift);
  return { root, lift };
}

/**
 * Roller-top module ("AMR.RollerTop") mounted on the AMR top (origin at the AMR floor centre):
 * a frame from AMR_DECK up to the belt height with a roller bed, so pallets transfer conveyor-style.
 */
export function createRollerTopModel() {
  const { width, length, height, rollerPitch, rollerRadius } = ROLLER_TOP_MODEL;
  const root = new Group();
  root.name = "AMR.RollerTop";
  const frameH = height - 2 * rollerRadius;
  root.add(part(box(width * 0.86, frameH, length * 0.86), materials.body, 0, AMR_DECK + frameH / 2, 0));
  for (const side of [-1, 1]) {
    root.add(part(box(0.05, 0.08, length), materials.frame, side * (width / 2 - 0.025), AMR_DECK + height - 0.04, 0));
    root.add(part(box(0.02, 0.03, length * 0.8), materials.accent, side * (width * 0.43 + 0.01), AMR_DECK + frameH * 0.6, 0));
  }
  const roller = new CylinderGeometry(rollerRadius, rollerRadius, width - 0.1, 12);
  for (let z = -length / 2 + rollerPitch / 2; z < length / 2; z += rollerPitch) {
    const mesh = new Mesh(roller, materials.deck);
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(0, AMR_DECK + height - rollerRadius, z);
    root.add(mesh);
  }
  return root;
}

/** Mobile rack: four posts, a deck per RACK_M_MODEL level, open between the legs for an AGV. */
export function createRackMobileModel() {
  const { width, depth, levels, post } = RACK_M_MODEL;
  const height = RACK_M_MODEL.height;
  const root = new Group();
  root.name = "Rack_m";
  const postGeometry = box(post, height, post);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      root.add(part(postGeometry, materials.frame, sx * (width / 2 - post / 2), height / 2, sz * (depth / 2 - post / 2)));
  for (const y of levels) {
    // Two side beams (along local X = loading face direction) and slats; the deck top is the pallet bottom.
    for (const sz of [-1, 1]) root.add(part(box(width, 0.06, post), materials.frame, 0, y - 0.03, sz * (depth / 2 - post / 2)));
    for (const sx of [-0.33, 0, 0.33]) root.add(part(box(0.08, 0.03, depth - post * 2), materials.deck, sx * width, y - 0.015, 0));
    root.add(part(box(0.03, 0.04, depth - post * 2), materials.accent, width / 2 - 0.015, y - 0.02, 0));
  }
  root.add(part(box(width, 0.04, 0.04), materials.accent, 0, height - 0.02, depth / 2 - 0.02));
  root.add(part(box(width, 0.04, 0.04), materials.accent, 0, height - 0.02, -depth / 2 + 0.02));
  return root;
}
