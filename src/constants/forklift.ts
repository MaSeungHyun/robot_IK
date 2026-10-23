import { Vector3 } from "three";
import { FORKLIFT_MODEL } from "@/constants/modelPoints.generated";
import { STREAM_CONFIG } from "@/constants/simulation";

/**
 * Forklift.glb as authored (metres, forward = local +Z, origin at the floor centre of the body).
 * The fork node (`Forklift.Fork`) slides up along +Y; `Forklift_point` under it is where the
 * pallet's fork-hole centre sits. Values come from scripts/gen-model-points.mjs.
 */
const [forkX, forkY, forkZ] = FORKLIFT_MODEL.fork,
  [pointX, pointY, pointZ] = FORKLIFT_MODEL.point;

export const FORKLIFT_CONFIG = {
  /** Fork node rest position in the forklift frame. */
  fork: new Vector3(forkX, forkY, forkZ),
  /** Forklift_point in the fork frame. */
  point: new Vector3(pointX, pointY, pointZ),
  /** Tine length (fork-local max z): the standoff kept before driving the forks in or out. */
  forkLength: FORKLIFT_MODEL.forkMax[2],
  /** Pallet group origin (bottom centre) in the fork frame: the hole centre is half the pallet height up. */
  palletOffset: new Vector3(pointX, pointY - STREAM_CONFIG.palletHeight / 2, pointZ),
  /** Fork lift (m above rest) while travelling with a pallet. */
  carryLift: 0.15,
  /** Extra lift above a shelf when picking up / before setting down. */
  clearance: 0.05,
  liftSpeed: 0.35,
  /** Slow straight drive while the forks go in / come out. */
  insertSpeed: 0.3,
  /**
   * Traffic / collision footprint from the model bounds: a capsule along local +Z with the half
   * width of the widest part (fork carriage / body), running from the counterweight to the tine tips.
   */
  footprint: footprintOf(),
};

function footprintOf() {
  const radius = Math.max(-FORKLIFT_MODEL.bodyMin[0], FORKLIFT_MODEL.bodyMax[0], -FORKLIFT_MODEL.forkMin[0], FORKLIFT_MODEL.forkMax[0]);
  const rearZ = FORKLIFT_MODEL.bodyMin[2], frontZ = forkZ + FORKLIFT_MODEL.forkMax[2];
  return {
    radius,
    /** Capsule segment (local z): ends pulled in by the radius so the caps meet the model's rear and tine tips. */
    rear: rearZ + radius,
    front: Math.max(rearZ + radius, frontZ - radius),
    /** Footprint (bounding box) centre, local z. */
    centre: (rearZ + frontZ) / 2,
    rearZ,
    frontZ,
  };
}

/** Circles (local z centres, shared radius) covering the capsule, for code that only knows circles. */
export const FORKLIFT_CIRCLES = (() => {
  const { rear, front, radius } = FORKLIFT_CONFIG.footprint,
    count = Math.max(2, Math.ceil((front - rear) / (radius * 0.5)) + 1);
  return Array.from({ length: count }, (_, i) => rear + ((front - rear) * i) / (count - 1));
})();

/** Distance from floor point (x, z) to the capsule axis of a forklift at origin (ox, oz) and `heading`, minus nothing (subtract the radius yourself). */
export function forkliftAxisDistance(x: number, z: number, ox: number, oz: number, heading: number) {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const { rear, front } = FORKLIFT_CONFIG.footprint;
  const along = Math.min(front, Math.max(rear, (x - ox) * fx + (z - oz) * fz));
  return Math.hypot(x - (ox + fx * along), z - (oz + fz * along));
}

/** Fork lift (above rest) that puts the carried pallet's bottom at world height `y`. */
export const forkLiftFor = (y: number) => y - (FORKLIFT_CONFIG.fork.y + FORKLIFT_CONFIG.palletOffset.y);

/** Forklift origin that puts Forklift_point over `target` (floor xz) at `heading`, backed off by `back` m. */
export function forkliftStop(target: Vector3, heading: number, back = 0) {
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const ahead = FORKLIFT_CONFIG.fork.z + FORKLIFT_CONFIG.point.z + back,
    side = FORKLIFT_CONFIG.fork.x + FORKLIFT_CONFIG.point.x;
  // Local +X is (cos, -sin) in world xz; forward is (sin, cos).
  return new Vector3(target.x - sin * ahead - cos * side, 0, target.z - cos * ahead + sin * side);
}