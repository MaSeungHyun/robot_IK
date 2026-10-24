/**
 * Factory layout design rules used by the auto-layout generator (see docs/layout-design-principles.md).
 * Pure data + math: no three.js / DOM, so it runs in a Web Worker.
 *
 * Each rule names the principle it encodes, where it comes from, and whether it is a hard constraint
 * (candidate rejected) or a score term (candidate ranked lower).
 */
import type { EquipmentKind } from "@/types/layout";
import { AMR_TRAFFIC } from "@/constants/simulatorLayout";

export type RuleKind = "constraint" | "score" | "generator";
export type DesignRule = { id: string; principle: string; kind: RuleKind; source: string; note: string };

/** AMR loaded envelope (m): 2 x AMR_TRAFFIC.loadedRadius (AMR.glb half diagonal; it covers the carried pallet). */
export const AMR_LOADED_DIAMETER = 2 * AMR_TRAFFIC.loadedRadius;
/** ISO 3691-4 Annex A operating zone: 0.5 m free on both sides of the vehicle path (up to 2.1 m high). */
export const ISO3691_SIDE_CLEARANCE = 0.5;

export const DESIGN_RULES = {
  aisleWidth: {
    id: "R-AISLE", kind: "constraint", principle: "AMR operating zone = loaded envelope + 0.5 m each side",
    source: "ISO 3691-4:2020 Annex A (operating zone clearance)", note: `aisle >= ${AMR_LOADED_DIAMETER.toFixed(2)} + 2 x 0.5 = ${(AMR_LOADED_DIAMETER + 1).toFixed(2)} m; reserved as an explicit rectangle no equipment may enter`,
  },
  mainAisleAllowance: {
    id: "R-MAIN-AISLE", kind: "constraint", principle: "Main aisles are planned explicitly, not left over",
    source: "R. Muther, Good Practice in Plant Layout (#10)", note: "aisle rectangles are part of the used area and of the fit check",
  },
  wallClearance: {
    id: "R-WALL", kind: "constraint", principle: "Clearance between equipment / routes and fixed structures",
    source: "ISO 3691-4 Annex A (0.5 m to fixed structures)", note: "0.5 m between every footprint or aisle and the walls",
  },
  doorKeepOut: {
    id: "R-DOOR", kind: "constraint", principle: "Keep the door approach free; shipping sits next to it",
    source: "SLP relationship: door-dock = E; door-equipment = X near the opening", note: "(door width + 1 m) x 3 m kept free inside the door",
  },
  reach: {
    id: "R-REACH", kind: "constraint", principle: "Pick point and every pallet corner inside the robot reach",
    source: "Palletizing cell practice (pick and pallet positions close to the robot)", note: "belt centre and far pallet corners <= reach",
  },
  noOverlap: {
    id: "R-OVERLAP", kind: "constraint", principle: "No overlapping footprints; unrelated equipment keeps a gap",
    source: "Layout feasibility", note: "SAT test, 0.15 m gap (0.05 m for a robot to its own belt/pallet, as in the existing templates)",
  },
  guarding: {
    id: "R-GUARD", kind: "constraint", principle: "Robot envelope guarded; people/door routes never cross it",
    source: "ISO 10218-2 / ISO 13857 (safeguarding, safety distances); palletizer pallet-exit muting practice",
    note: "the reach circle may touch the AMR aisle only at its own pallet (load transfer area, muted exit); door keep-out may not touch any reach circle",
  },
  flowPattern: {
    id: "R-PATTERN", kind: "generator", principle: "Evaluate several flow patterns: straight (I), L, U",
    source: "Muther SLP / Tompkins Facilities Planning (line flow patterns)", note: "U keeps inlet and shipping on one side (one door); straight is shortest",
  },
  unidirectionalFlow: {
    id: "R-FLOW", kind: "generator", principle: "Material moves one way: inlet -> robots -> pallets -> AMR -> dock at the door",
    source: "SLP flow analysis (minimise backtracking)", note: "docks sit at the inlet end of the aisle, rotated toward the door",
  },
  noCrossings: {
    id: "R-CROSS", kind: "score", principle: "Minimise crossings between AMR routes and conveyors",
    source: "SLP flow diagram (avoid crossing flows)", note: "+penalty per pallet->dock straight route crossing a belt",
  },
  closeness: {
    id: "R-SLP", kind: "score", principle: "Closeness by activity relationship (A/E/I/O/U/X)",
    source: "R. Muther, Systematic Layout Planning (relationship chart)", note: "weighted distance of related pairs; X pairs penalised when close",
  },
  infeedBuffer: {
    id: "R-BUFFER", kind: "generator", principle: "Accumulation before the bottleneck (30-60 s at target rate)",
    source: "Palletizing layout guides (infeed accumulation 30-60 s)", note: "empty inlet segments before the first robot, 1..3",
  },
  palletChange: {
    id: "R-PALLET-CHANGE", kind: "score", principle: "Pallet change must not stop the line",
    source: "Palletizing cell practice (second pallet position / buffer)", note: "simulated share of time a full pallet waits for an AMR is penalised",
  },
  storage: {
    id: "R-STORAGE", kind: "constraint", principle: "Buffer storage for finished pallets sized from output x storage time",
    source: "Warehouse design practice (storage capacity = throughput x dwell time; Frazelle, World-Class Warehousing)",
    note: "rack slots = ceil(target x hours / boxes per pallet); racks are required, missing capacity scored x200",
  },
  travel: {
    id: "R-TRAVEL", kind: "score", principle: "Minimise material-handling travel (store + retrieve)",
    source: "Tompkins et al., Facilities Planning (flow distance x volume)", note: "mean pallet->rack + rack->dock straight-line metres, x0.3",
  },
  throughput: {
    id: "R-RATE", kind: "score", principle: "Meet the target rate with the least equipment and area",
    source: "Facilities planning evaluation (cost/benefit of alternatives)", note: "unmet rate dominates; then equipment cost, area, waiting",
  },
} as const satisfies Record<string, DesignRule>;

export function aisleWidth(loadedDiameter = AMR_LOADED_DIAMETER, side = ISO3691_SIDE_CLEARANCE) {
  return loadedDiameter + 2 * side;
}
/** Empty inlet segments that hold `seconds` of boxes at the belt speed (bounded 1..3). */
export function inletSegments(beltSpeed: number, segmentLength: number, seconds = 45) {
  return Math.min(3, Math.max(1, Math.ceil((beltSpeed * seconds) / segmentLength / 2)));
}

/** SLP closeness: A=absolutely necessary ... X=undesirable. Weights are per metre of centre distance. */
export const CLOSENESS = { A: 16, E: 8, I: 4, O: 2, U: 0, X: -16 } as const;
export type Closeness = keyof typeof CLOSENESS;
/** Relationship chart between equipment kinds (unordered). */
export const RELATIONSHIPS: Partial<Record<`${EquipmentKind}-${EquipmentKind}`, Closeness>> = {
  "conveyor-robot": "A", "robot-pallet": "A", "pallet-amr": "E", "pallet-dock": "I", "pallet-rack": "E",
  "dock-door": "E", "rack-door": "E", "rack-dock": "E", "rack-amr": "I", "robot-door": "X", "robot-amr": "X",
};
export function relationship(a: EquipmentKind, b: EquipmentKind): Closeness {
  return RELATIONSHIPS[`${a}-${b}`] ?? RELATIONSHIPS[`${b}-${a}`] ?? "U";
}
type Placed = { kind: EquipmentKind; x: number; z: number };
/**
 * SLP closeness cost (lower = better): for each related pair, rating weight x distance, normalised per pair.
 * Only the nearest partner counts for A/E/I/O (a robot needs *a* belt close, not every belt); X pairs
 * add a penalty when closer than `xRange`.
 */
export function closenessCost(items: readonly Placed[], xRange = 3) {
  let cost = 0, pairs = 0;
  for (const a of items) {
    const best = new Map<EquipmentKind, number>();
    for (const b of items) {
      if (a === b) continue;
      const rating = relationship(a.kind, b.kind), d = Math.hypot(a.x - b.x, a.z - b.z);
      if (rating === "X") { if (d < xRange) cost += -CLOSENESS.X * (xRange - d); continue; }
      if (rating === "U") continue;
      best.set(b.kind, Math.min(best.get(b.kind) ?? Infinity, d));
    }
    for (const [kind, d] of best) { cost += CLOSENESS[relationship(a.kind, kind)] * d; pairs++; }
  }
  return pairs ? cost / pairs : 0;
}
/** Proper segment intersection in the floor plane. */
export function segmentsCross(p: Placed, q: Placed, r: { x: number; z: number }, s: { x: number; z: number }) {
  const o = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }) => Math.sign((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  return o(p, q, r) !== o(p, q, s) && o(r, s, p) !== o(r, s, q);
}
