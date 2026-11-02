import { Vector3 } from "three";
import { PROP_FOOTPRINTS, type PropFootprint } from "@/constants/propFootprints";
import type { SceneEquipment } from "@/types/layout";
import type { TemplateProp } from "@/types/sceneTemplate";

/** Line props: neighbouring parts (posts, panels) closer than this (m) are joined so routes cannot slip between them. */
const LINE_JOIN = 3.2;
/** Equipment centre within this (m) of a prop part: the prop stands in for that equipment (decor pallet on a station, rack
 * model under a placed rack) and is not an obstacle; the equipment's own clearance applies. */
const EQUIPMENT_MARGIN = 0.6;
const LINE_PROP = /^(fence|guardrail|barrier)/;

export type PropSegment = { a: Vector3; b: Vector3; radius: number };

const inside = (p: PropFootprint, x: number, z: number, margin: number) => {
  const dx = x - p.x, dz = z - p.z, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  // Into the part frame (rotation by -yaw about +Y).
  const u = c * dx - s * dz, v = s * dx + c * dz;
  return Math.abs(u) <= p.w / 2 + margin && Math.abs(v) <= p.d / 2 + margin;
};

/** One part = a segment along its long side, radius = half the short side. */
function partSegment(p: PropFootprint): PropSegment {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  // Part-frame axes in world: x' = (c, -s), z' = (s, c).
  const long = p.w >= p.d, half = Math.max(0, (long ? p.w : p.d) - (long ? p.d : p.w)) / 2;
  const ax = long ? { x: c, z: -s } : { x: s, z: c };
  return {
    a: new Vector3(p.x - ax.x * half, 0, p.z - ax.z * half),
    b: new Vector3(p.x + ax.x * half, 0, p.z + ax.z * half),
    radius: Math.min(p.w, p.d) / 2,
  };
}

/**
 * Static template props (factory.glb columns, fences, barriers, guardrails, decor pallets and racks) as AMR / forklift
 * route obstacles. Props moved by a template override (position / yaw) are skipped: the footprints are baked at the
 * authored node transform. Parts covering placed equipment are skipped (the equipment is the obstacle there).
 */
export function propSegments(props: readonly TemplateProp[], objects: readonly SceneEquipment[]): PropSegment[] {
  const equipment = objects.filter((o) => o.kind !== "floor" && o.kind !== "door");
  const out: PropSegment[] = [];
  for (const prop of props) {
    if (prop.source !== "factory" || prop.position || prop.yaw !== undefined) continue;
    const parts = (PROP_FOOTPRINTS[prop.node] ?? []).filter((p) => !equipment.some((o) => inside(p, o.x, o.z, EQUIPMENT_MARGIN)));
    out.push(...parts.map(partSegment));
    if (!LINE_PROP.test(prop.node)) continue;
    // Join each part to its nearest neighbour (a fence run of posts becomes one line).
    for (let i = 0; i < parts.length; i++) {
      let best = -1, gap = LINE_JOIN;
      for (let j = 0; j < parts.length; j++) {
        if (j === i) continue;
        const d = Math.hypot(parts[j].x - parts[i].x, parts[j].z - parts[i].z) - Math.max(parts[i].w, parts[i].d, parts[j].w, parts[j].d) / 2;
        if (d < gap) { gap = d; best = j; }
      }
      if (best >= 0) {
        const p = parts[i], q = parts[best];
        out.push({ a: new Vector3(p.x, 0, p.z), b: new Vector3(q.x, 0, q.z), radius: Math.max(0.05, Math.min(p.w, p.d, q.w, q.d) / 2) });
      }
    }
  }
  return out;
}