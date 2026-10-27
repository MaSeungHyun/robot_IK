import { AUTO_LAYOUT_DEFAULTS } from "@/constants/auto-layout";
/**
 * Auto layout (step 1): pure geometry for generating palletizing-line layouts from constraints.
 * No three.js / DOM / store imports, so it can run in a Web Worker. Simulation-based scoring lives
 * in the caller (scripts/auto-layout.mjs today; a worker later) and is combined via `scoreLayout`.
 *
 * Frame: the floor is centred on (0, 0); width runs along x, depth along z. A conveyor at yaw 0
 * flows toward +z (see conveyorLayout.beltLocalPoint).
 */
import { Vector3 } from "three";
import { CONVEYOR_LAYOUT as BELT } from "@/constants/conveyorLayoutConfig";
import { RACK_CONFIG, RACK_FACE_YAW, rackStandoff } from "@/constants/rack";
import { beltLength, beltPoint, extendBelt } from "@/domain/conveyor/conveyorLayout";
import { pathBounds } from "@/domain/conveyor/conveyorPaths";
import type { ConveyorTurn, EquipmentKind, EquipmentSettings } from "@/types/layout";
import type { TemplateLink } from "@/types/links";
import type { SceneTemplate, TemplateEquipment } from "@/types/sceneTemplate";
import { aisleWidth, closenessCost, inletSegments, segmentsCross } from "@/domain/layout/designRules";
import { BOX_SIZES, PALLET_STACKING, STREAM_CONFIG } from "@/constants/simulation";
import { MODEL_FOOTPRINT as F } from "@/constants/footprints";
import { planStack } from "@/domain/pallet/packing/stacking";
import { AMR_TRAFFIC, SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { SCAN_TUNNEL, scanTunnelPose } from "@/domain/conveyor/scanTunnel";

export type Wall = "south" | "north" | "east" | "west";
export type LayoutConstraints = {
  /** Floor size in m (rounded up to whole cells). */
  width: number;
  depth: number;
  /** Wall height in m (0 = floor only). */
  height?: number;
  /** Required boxes per hour (all lines together). */
  targetPerHour: number;
  /** Door on a wall; `offset` is along the wall from its centre (m). Docks are placed toward it. */
  door?: { wall: Wall; offset?: number; width?: number };
  maxRobots?: number;
  maxAmrs?: number;
  /** AMR aisle width (m). Loaded AMR swept diameter is ~1.64 m. */
  aisle?: number;
  /** Robot reach radius (m); geometry below is checked against it. */
  reach?: number;
  /** Keep-out distance from walls (m). */
  wallClearance?: number;
  /** R-STORAGE: hours of output to hold in racks (default 2). Ignored when `storagePallets` is set. */
  storageHours?: number;
  /** R-STORAGE: explicit rack capacity in pallets (overrides `storageHours`). */
  storagePallets?: number;
  /** Boxes per full pallet (default 40 = 2 layers x 20). */
  boxesPerPallet?: number;
  /** Upper bound on racks (storage shortfall is scored when the requirement needs more). */
  maxRacks?: number;
  /** "target" (default): smallest layout meeting targetPerHour. "fixed": place `fixed` equipment, max throughput. */
  mode?: LayoutMode;
  fixed?: FixedEquipment;
};
/** Rack slots per rack, from the Rack.glb slot empties. */
export const RACK_SLOTS = RACK_CONFIG.slots.length;
/** R-STORAGE: pallets to store and racks needed for them (racks capped by maxRacks). */
export function storageRequirement(constraints: LayoutConstraints) {
  const perPallet = constraints.boxesPerPallet ?? PALLET_CAPACITY;
  const pallets = Math.max(1, Math.ceil(constraints.storagePallets ?? (constraints.targetPerHour * (constraints.storageHours ?? 2)) / perPallet));
  const needed = Math.ceil(pallets / RACK_SLOTS);
  return { pallets, needed, racks: Math.min(needed, constraints.maxRacks ?? Infinity) };
}
export type LayoutPattern = "straight" | "L" | "U";
export type LayoutParams = {
  pattern: LayoutPattern;
  /**
   * Parallel lines (cells). Straight: lines are paired as mirrored twins sharing one aisle, pairs side by side.
   * L/U: each line is its own cell (turns on its right), cells side by side, each with its own aisle.
   */
  lines: number;
  /** Robots per line (each robot gets its own pallet station). */
  robotsPerLine: number;
  amrs: number;
  docks: number;
  racks: number;
  /** Seconds between boxes per line inlet; default derives from the target. */
  spawnInterval?: number;
  /** Exact robot total spread over the lines (first lines get the remainder); default robotsPerLine x lines. */
  robots?: number;
  /** Rows of line units stacked along the flow (grid of units); default 1. */
  stack?: number;
  /**
   * R-NEAR: "lineEnd" puts each unit's racks right past its line output (short pallet -> forklift legs);
   * "row" keeps them in the dock row. Unset: try lineEnd (stack 1, then 2), then row; first that fits wins.
   */
  rackPlacement?: "lineEnd" | "row";
};
export type LayoutMode = "target" | "fixed";
/** Fixed-equipment mode: place these counts (as many as fit) and maximise throughput. */
export type FixedEquipment = { robots: number; amrs: number; racks: number; docks: number };
export type LayoutCandidate = {
  params: LayoutParams;
  template: SceneTemplate;
  /** Geometry problems; a candidate with issues should not be simulated. */
  issues: string[];
  /** R-CROSS: pallet->dock straight routes that cross a conveyor. */
  crossings: number;
  /** R-SLP closeness cost (lower = related equipment closer, X pairs apart). */
  closeness: number;
  counts: Record<"robots" | "pallets" | "conveyors" | "amrs" | "docks" | "racks", number> & {
    /** Dedicated rack-unloading AMRs (door layouts only); not in `amrs`, not in the cost score. */
    forklifts: number;
    /** Optional Rack_m buffer (with one AGV) beside the line; 0 or 1. */
    rackM?: number;
  };
  /** R-STORAGE: rack slots placed vs pallets that must be stored. */
  storage: { slots: number; required: number };
  /** R-TRAVEL: mean straight-line AMR metres per pallet for store (pallet->rack) + retrieve (rack->dock/door). */
  travel: number;
  /** R-NEAR: mean straight-line metres from each pallet station to its nearest rack (the AMR store leg). */
  rackDistance: number;
  /**
   * Outbound hook (not simulated yet): rack -> dock pairs for a future release step (rack -> AMR -> dock/door).
   * Indices into template.equipment.
   */
  outbound: { rack: number; dock: number }[];
  /** Area (m^2) of the equipment + aisle bounding box. */
  usedArea: number;
  /** R-FIT: 0 = layout aspect matches the floor, grows as it becomes a thin strip on a wide floor. */
  fit?: number;
};

/** Spacing rules (m), from the existing templates and navigation footprints. */
/** Boxes per pallet: best grid of box.glb on pallet.glb x the layers the rack shelf pitch allows. */
const PALLET_CAPACITY = planStack(1, new Vector3(STREAM_CONFIG.palletWidth, 0, STREAM_CONFIG.palletDepth), BOX_SIZES[0], 0).capacity * PALLET_STACKING.layers;
const ROBOT_FOOTPRINT = F.robot[0];
/** Belt gap per box (m) the spacing needs: box length + 0.325 m spawn gap. */
const BOX_PITCH = Math.max(BOX_SIZES[0].x, BOX_SIZES[0].z) + 0.325;
/** AMR start pitch along an aisle (bodies never touch). */
const AMR_PITCH = 2 * (AMR_TRAFFIC.emptyRadius + AMR_TRAFFIC.layoutGap);
/** Dock row half depth + margin to the aisle edge. */
const DOCK_EDGE = F.amr[1] / 2 + 0.2;
export const LAYOUT_RULES = {
  /** Belt centre -> robot base: rail half width + robot half footprint + 5 cm. */
  /** Base footprint + 0.2 m: the shoulder joint sits off the base axis and must not swing over the belt side rail. */
  beltToRobot: BELT.width / 2 + ROBOT_FOOTPRINT / 2 + 0.2,
  /** Robot base -> pallet centre: robot half footprint + pallet half width + 12.5 cm (old 1.0 with a 1.1 m pallet). */
  robotToPallet: ROBOT_FOOTPRINT / 2 + AMR_TRAFFIC.loadedRadius + 0.05,
  /**
   * Robot spacing along a line (the old 2.5 m segment pitch). Rails (rail.glb) are much longer than this, so
   * robots are placed by distance along the chain, not one per segment.
   */
  robotPitch: 2 * (AMR_TRAFFIC.loadedRadius + AMR_TRAFFIC.layoutGap),
  /** R-AISLE: loaded AMR envelope + ISO 3691-4 0.5 m each side. */
  aisle: aisleWidth(),
  /** R-WALL. */
  wallClearance: 0.5,
  /** Gap kept between unrelated footprints. */
  gap: 0.15,
  doorKeepOut: 3,
  footprint: {
    conveyor: [BELT.width, BELT.length], pallet: [STREAM_CONFIG.palletWidth, STREAM_CONFIG.palletDepth], dock: F.amr,
    // Rack as laid out here: [width along its face, depth], face toward layout +z (model yaw adds RACK_FACE_YAW).
    rack: [RACK_CONFIG.footprint[1], RACK_CONFIG.footprint[0]],
    robot: [ROBOT_FOOTPRINT, ROBOT_FOOTPRINT], amr: F.amr, scanner: [SCAN_TUNNEL.width, SCAN_TUNNEL.length], floor: [0, 0], door: [0, 0],
  } as Record<EquipmentKind, [number, number]>,
  /** Belt speed so boxes (0.275 m) keep >= 0.5 m spacing at the inlet. */
  minBeltSpeed: 0.25,
};

type Rect = { cx: number; cz: number; yaw: number; w: number; d: number; tag: string; index?: number };
type Item = TemplateEquipment & { line?: number };

/** Unit normal to the flow (x, z) = (cos, -sin): +1 side is +x for a belt at yaw 0. */
const NORMAL = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

function rectOf(item: Item, index: number): Rect {
  const [w, d] = LAYOUT_RULES.footprint[item.kind];
  if (item.kind === "conveyor" && item.conveyorPath) {
    const b = pathBounds(item.conveyorPath), c = Math.cos(item.yaw), s = Math.sin(item.yaw), mx = (b.minX + b.maxX) / 2, mz = (b.minZ + b.maxZ) / 2;
    return { cx: item.x + mx * c + mz * s, cz: item.z - mx * s + mz * c, yaw: item.yaw, w: b.maxX - b.minX + BELT.width, d: b.maxZ - b.minZ + BELT.width, tag: "conveyor-turn", index };
  }
  if (item.kind === "conveyor" && item.conveyorLength && !item.conveyorTurn) return { cx: item.x, cz: item.z, yaw: item.yaw, w, d: item.conveyorLength, tag: "conveyor", index };
  if (item.kind === "conveyor" && item.conveyorTurn && item.conveyorTurn !== "straight") {
    // Quarter turn: bounding square of the arc (centre of the arc's chord box).
    const mid = beltPoint(item, beltLength(item) / 2);
    const size = BELT.radius + BELT.width;
    return { cx: mid.x, cz: mid.z, yaw: item.yaw, w: size, d: size, tag: "conveyor-turn", index };
  }
  return { cx: item.x, cz: item.z, yaw: item.kind === "rack" ? item.yaw - RACK_FACE_YAW : item.yaw, w, d, tag: item.kind, index };
}
type Pt = { x: number; z: number };
/** Corner cache: rects are shifted in place, so an entry is reused only while its pose/size is unchanged. */
const cornerCache = new WeakMap<Rect, { cx: number; cz: number; yaw: number; w: number; d: number; pts: Pt[] }>();
const SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
function corners(r: Rect): Pt[] {
  const hit = cornerCache.get(r);
  if (hit && hit.cx === r.cx && hit.cz === r.cz && hit.yaw === r.yaw && hit.w === r.w && hit.d === r.d) return hit.pts;
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw), pts: Pt[] = new Array(4);
  for (let k = 0; k < 4; k++) {
    const lx = (SIGNS[k][0] * r.w) / 2, lz = (SIGNS[k][1] * r.d) / 2;
    pts[k] = { x: r.cx + lx * c + lz * s, z: r.cz - lx * s + lz * c };
  }
  cornerCache.set(r, { cx: r.cx, cz: r.cz, yaw: r.yaw, w: r.w, d: r.d, pts });
  return pts;
}
function projectOn(pts: Pt[], ax: number, az: number, out: [number, number]) {
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { const v = p.x * ax + p.z * az; if (v < lo) lo = v; if (v > hi) hi = v; }
  out[0] = lo; out[1] = hi;
}
const PA: [number, number] = [0, 0], PB: [number, number] = [0, 0];
/** Separating-axis overlap test with a margin; bounding-circle early exit, no per-call allocations. */
export function rectsOverlap(a: Rect, b: Rect, margin = 0) {
  const reach = Math.hypot(a.w, a.d) / 2 + Math.hypot(b.w, b.d) / 2 + margin;
  const dx = a.cx - b.cx, dz = a.cz - b.cz;
  if (dx * dx + dz * dz >= reach * reach) return false;
  const ca = corners(a), cb = corners(b);
  for (let k = 0; k < 4; k++) {
    const yaw = k < 2 ? a.yaw : b.yaw;
    const ax = k % 2 ? Math.cos(yaw) : Math.sin(yaw), az = k % 2 ? -Math.sin(yaw) : Math.cos(yaw);
    projectOn(ca, ax, az, PA); projectOn(cb, ax, az, PB);
    if (PA[1] + margin <= PB[0] || PB[1] + margin <= PA[0]) return false;
  }
  return true;
}

/** Robot slot: segment index in the chain and distance along that (straight) segment. */
type Slot = { segment: number; distance: number };
/**
 * Conveyor chain for a pattern, in rail.glb segments, and robot slots by distance along it. Robots sit beside
 * straight rails, on the outside of turns. The first leg starts with the scan tunnel (boxes leave it at
 * SCAN_TUNNEL.exitDistance) plus `inlet` m of empty accumulation belt (R-BUFFER); later legs leave half a pitch
 * after the turn. Every leg ends half a pitch past its last robot, then runs to the end of its last rail; the last
 * leg instead slides its robots downstream so the final one works the box held at the end stopper.
 */
function chainFor(pattern: LayoutPattern, robots: number, inlet: number, pitch: number) {
  const first = pattern === "straight" ? robots : Math.ceil(robots / (pattern === "L" ? 2 : 3));
  const last = pattern === "L" ? robots - first : Math.ceil((robots - first) / 2);
  const legs = pattern === "straight" ? [robots] : pattern === "L" ? [first, last] : [first, robots - first - last, last];
  const turns: ConveyorTurn[] = [], slots: Slot[] = [];
  legs.forEach((count, leg) => {
    if (leg) turns.push("right");
    const lead = leg ? pitch / 2 : SCAN_TUNNEL.exitDistance + inlet;
    const start = turns.length, rails = Math.max(1, Math.ceil((lead + count * pitch) / BELT.length));
    // Last leg: the line stops when a box reaches the stopper, so its last robot must sit at the stop point.
    const shift = leg === legs.length - 1 ? Math.max(0, rails * BELT.length - BOX_SIZES[0].z / 2 - (lead + pitch * (count - 0.5))) : 0;
    for (let k = 0; k < count; k++) {
      const along = lead + shift + pitch * (k + 0.5), index = Math.min(rails - 1, Math.floor(along / BELT.length));
      slots.push({ segment: start + index, distance: along - index * BELT.length });
    }
    for (let k = 0; k < rails; k++) turns.push("straight");
  });
  return { turns, slots };
}

function settingsFor(kind: EquipmentKind, interval: number): Partial<EquipmentSettings> | undefined {
  if (kind !== "conveyor") return undefined;
  return { spawnInterval: +interval.toFixed(3), beltSpeed: +Math.max(LAYOUT_RULES.minBeltSpeed, BOX_PITCH / interval).toFixed(4) };
}

/**
 * Builds one candidate. Robots on side -1 (left of the flow; outside of right turns) unless the line is the
 * mirrored second line of a straight pair. Docks/racks sit at the upstream end of the aisle, toward the door.
 */
export function buildLayout(constraints: LayoutConstraints, params: LayoutParams): LayoutCandidate {
  const ckey = JSON.stringify(constraints);
  if (ckey !== memoKey) { memo.clear(); memoKey = ckey; }
  const key = JSON.stringify(params);
  let hit = memo.get(key);
  if (!hit) { hit = buildUncached(constraints, params); memo.set(key, hit); }
  return hit;
}
/** Geometry memo (per constraint set): the search revisits the same params (grow/trim, fixed-mode variants). */
const memo = new Map<string, LayoutCandidate>();
let memoKey = "";
/** Pallet moves one forklift handles per hour (pick-up, travel, set-down); beyond this a forklift is the bottleneck. */
export const FORKLIFT_PALLETS_PER_HOUR = 18;
/** Rack_m + AGV buffer is added only when the mean pallet -> main rack leg is at least this long (m). */
export const RACK_M_MIN_DISTANCE = 15;
/** Forklifts per layout: at least one per cell, more when the pallet rate exceeds the cell forklifts' capacity. */
export function forkliftsFor(constraints: LayoutConstraints, lines: number) {
  const pallets = constraints.targetPerHour / (constraints.boxesPerPallet ?? PALLET_CAPACITY);
  return Math.max(lines, Math.ceil(pallets / FORKLIFT_PALLETS_PER_HOUR));
}
/** Deterministic forklift mode: carrier when AMRs are fewer than the cells, otherwise service (re-load onto AMRs). */
export function forkliftModeFor(amrs: number, lines: number): "carrier" | "service" {
  return amrs < lines ? "carrier" : "service";
}
function buildUncached(constraints: LayoutConstraints, params: LayoutParams): LayoutCandidate {
  if (params.rackPlacement) return buildOriented(constraints, params);
  const variants: LayoutParams[] = [
    { ...params, rackPlacement: "lineEnd", stack: params.stack ?? 1 },
    ...(params.stack ? [] : [{ ...params, rackPlacement: "lineEnd" as const, stack: 2 }]),
    { ...params, rackPlacement: "row", stack: params.stack ?? 1 },
  ];
  let first: LayoutCandidate | null = null;
  for (const variant of variants) {
    const candidate = buildLayout(constraints, variant);
    if (!candidate.issues.length) return candidate;
    first ??= candidate;
  }
  return first!;
}
function buildOriented(constraints: LayoutConstraints, params: LayoutParams): LayoutCandidate {
  if (constraints.door) return buildFacing(constraints, params, constraints.door.wall);
  // No door: try the line along both floor axes; keep the one with fewer issues (fit first), then smaller area.
  const options = (["south", "west"] as Wall[]).map((wall) => buildFacing(constraints, params, wall));
  return options.sort((a, b) => a.issues.length - b.issues.length || a.usedArea - b.usedArea)[0];
}
function buildFacing(constraints: LayoutConstraints, params: LayoutParams, facing: Wall): LayoutCandidate {
  const rules = LAYOUT_RULES, aisle = constraints.aisle ?? rules.aisle, reach = constraints.reach ?? SIMULATOR_CONFIG.reach;
  const issues: string[] = [];
  const lines = Math.max(1, Math.round(params.lines));
  const interval = params.spawnInterval ?? (3600 * lines) / constraints.targetPerHour;
  const items: Item[] = [];
  const robotsOf: number[][] = [], palletsOf: number[][] = [], headOf: number[] = [];
  const aisles: Rect[] = [];
  const palletOuter = rules.beltToRobot + rules.robotToPallet + STREAM_CONFIG.palletWidth / 2;
  // Lines are built in units: a straight unit is a mirrored pair (line 2k at x = 0, line 2k+1 mirrored toward
  // its aisle); an L/U unit is one line. Each new unit is shifted to +x so it clears the previous units
  // (equipment + aisles) by `unitGap`.
  const perUnit = params.pattern === "straight" ? 2 : 1;
  const unitGap = 0.8;
  const totalRobots = Math.max(lines, Math.round(params.robots ?? params.robotsPerLine * lines));
  const robotsForLine = (l: number) => Math.floor(totalRobots / lines) + (l < totalRobots % lines ? 1 : 0);
  const units = Math.ceil(lines / perUnit);
  const stack = Math.max(1, Math.min(Math.round(params.stack ?? 1), units));
  const cols = Math.ceil(units / stack);
  const lineEnd = params.rackPlacement === "lineEnd";
  const racksForUnit = (u: number) => (lineEnd ? Math.floor(params.racks / units) + (u < params.racks % units ? 1 : 0) : 0);
  const rackPitch = rules.footprint.rack[0] + 0.6;
  // Rack access aisle: never narrower than the loaded AMR stopped at the rack standoff (rack.ts) plus its margin.
  const rackAccess = Math.max(aisle, rackStandoff(0) + AMR_TRAFFIC.loadedRadius + AMR_TRAFFIC.layoutGap);
  const rackRowPitch = rules.footprint.rack[1] + rackAccess + 0.3;
  const extraRackItems: number[] = [];
  const crossBands: { z: number }[] = [];
  let unitStartItem = 0, unitStartAisle = 0, unitMaxX = -Infinity, baseX0: number | null = null;
  let rowMaxZ = -Infinity, zBase = 0;
  const extent = (from: number, fromAisle: number) => {
    const e = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    const grow = (r: Rect) => { for (const q of corners(r)) { if (q.x < e.x0) e.x0 = q.x; if (q.x > e.x1) e.x1 = q.x; if (q.z < e.z0) e.z0 = q.z; if (q.z > e.z1) e.z1 = q.z; } };
    for (let k = from; k < items.length; k++) grow(rectOf(items[k], k));
    for (let k = fromAisle; k < aisles.length; k++) grow(aisles[k]);
    return e;
  };
  // R-NEAR: the unit's racks sit just past its line output, fronts facing the line, reached from the unit aisle.
  const placeUnitRacks = (count: number) => {
    const lineAisles = aisles.slice(unitStartAisle);
    const ext = extent(unitStartItem, unitStartAisle);
    const cx = lineAisles.length ? lineAisles.reduce((sum, a) => sum + a.cx, 0) / lineAisles.length : (ext.x0 + ext.x1) / 2;
    const perRow = Math.max(1, Math.floor((ext.x1 - ext.x0 + 0.6) / rackPitch));
    for (let row = 0, placed = 0; placed < count; row++) {
      const n = Math.min(perRow, count - placed);
      const front = ext.z1 + rackAccess + 0.2 + row * rackRowPitch;
      let x = cx - (n * rackPitch - 0.6) / 2;
      aisles.push({ cx, cz: front - (rackAccess + 0.2) / 2, yaw: 0, w: Math.max(aisle, n * rackPitch), d: rackAccess, tag: "aisle" });
      for (let k = 0; k < n; k++) {
        extraRackItems.push(items.length);
        items.push({ kind: "rack", x: x + rules.footprint.rack[0] / 2, z: front + rules.footprint.rack[1] / 2, yaw: Math.PI + RACK_FACE_YAW });
        x += rackPitch;
      }
      placed += n;
    }
  };
  const closeUnit = (u: number) => {
    if (items.length === unitStartItem) return;
    const count = racksForUnit(u);
    if (count) placeUnitRacks(count);
    const col = u % cols, row = Math.floor(u / cols);
    if (col === 0) {
      if (row > 0) { crossBands.push({ z: rowMaxZ + (aisle + 0.6) / 2 }); zBase = rowMaxZ + aisle + 0.6; }
      unitMaxX = -Infinity; rowMaxZ = -Infinity;
    }
    const ext = extent(unitStartItem, unitStartAisle);
    baseX0 ??= ext.x0;
    const sx = col === 0 ? baseX0 - ext.x0 : unitMaxX + unitGap - ext.x0;
    const sz = row === 0 ? 0 : zBase - ext.z0;
    for (let k = unitStartItem; k < items.length; k++) { items[k].x += sx; items[k].z += sz; }
    for (let k = unitStartAisle; k < aisles.length; k++) { aisles[k].cx += sx; aisles[k].cz += sz; }
    unitMaxX = ext.x1 + sx; rowMaxZ = Math.max(rowMaxZ, ext.z1 + sz);
    unitStartItem = items.length; unitStartAisle = aisles.length;
  };
  for (let line = 0; line < lines; line++) {
    if (line && line % perUnit === 0) closeUnit(line / perUnit - 1);
    const twin = line % perUnit === 1;
    const side = twin ? 1 : -1;
    const start = { x: twin ? -(2 * palletOuter + aisle) : 0, z: 0, yaw: 0, conveyorTurn: "straight" as ConveyorTurn };
    const beltSpeed = Math.max(rules.minBeltSpeed, BOX_PITCH / interval);
    const chain = chainFor(params.pattern, robotsForLine(line), inletSegments(beltSpeed, rules.robotPitch) * rules.robotPitch, rules.robotPitch);
    let pose = start;
    robotsOf[line] = []; palletsOf[line] = [];
    const poses: (typeof start)[] = [];
    chain.turns.forEach((turn, i) => {
      if (i) pose = { ...extendBelt(pose, turn), conveyorTurn: turn };
      poses.push(pose);
      headOf[line] ??= items.length;
      items.push({ kind: "conveyor", x: pose.x, z: pose.z, yaw: pose.yaw, ...(turn !== "straight" ? { conveyorTurn: turn } : {}), settings: i ? undefined : settingsFor("conveyor", interval), line });
    });
    // ScanTunnel.glb heads the line, over the start of the first rail.
    items.push({ kind: "scanner", ...scanTunnelPose(poses[0]), line });
    for (const slot of chain.slots) {
      const p = beltPoint(poses[slot.segment], slot.distance), n = NORMAL(p.yaw);
      const at = (distance: number) => ({ x: p.x + side * n.x * distance, z: p.z + side * n.z * distance });
      const robot = at(rules.beltToRobot), pallet = at(rules.beltToRobot + rules.robotToPallet);
      robotsOf[line].push(items.length);
      items.push({ kind: "robot", ...robot, yaw: p.yaw, line });
      palletsOf[line].push(items.length);
      items.push({ kind: "pallet", ...pallet, yaw: p.yaw, line });
      const aisleCentre = at(palletOuter + aisle / 2);
      aisles.push({ cx: aisleCentre.x, cz: aisleCentre.z, yaw: p.yaw, w: aisle, d: rules.robotPitch + 0.01, tag: "aisle" });
      // Reach check: belt centre line and the far pallet corners.
      const far = Math.hypot(rules.robotToPallet + STREAM_CONFIG.palletWidth / 2, STREAM_CONFIG.palletDepth / 2);
      if (rules.beltToRobot > reach || far > reach) issues.push(`로봇 작업 반경(${reach}m) 밖에 컨베이어/팔레트가 있습니다.`);
    }
  }
  closeUnit(units - 1);
  const lineX = { x0: Math.min(...items.map((it) => it.x)), x1: Math.max(...items.map((it) => it.x)) };
  // Stacked rows: a cross aisle between unit rows and a side aisle linking them to the dock row.
  if (crossBands.length) {
    const zTop = Math.max(...items.map((it) => it.z));
    for (const band of crossBands) aisles.push({ cx: (lineX.x0 + lineX.x1) / 2, cz: band.z, yaw: 0, w: lineX.x1 - lineX.x0 + 2, d: aisle, tag: "aisle" });
    aisles.push({ cx: lineX.x0 - 1 - aisle / 2, cz: zTop / 2, yaw: 0, w: aisle, d: Math.max(aisle, zTop), tag: "aisle" });
  }
  // Dock / rack row at the upstream end, below every conveyor head, with a cross aisle in front (R-AISLE).
  // Docks sit at the main aisle (shortest pallet route), racks split to both sides (R-STORAGE, R-SLP).
  const firstRobotZ = Math.min(...items.filter((it) => it.kind === "robot").map((it) => it.z));
  const headZ = Math.min(...items.filter((it) => it.kind === "conveyor").map((it) => it.z)) - BELT.length / 2;
  const aisleX = -(palletOuter + aisle / 2);
  const destinations: number[] = [...extraRackItems], rackItems: number[] = [...extraRackItems], dockItems: number[] = [];
  const rowRacks = lineEnd ? 0 : params.racks;
  // R-STORAGE rows: the front row (with the docks) is capped near the line block's width; extra racks go to
  // back rows behind it, each with its own access aisle, so many racks don't stretch one endless row.
  const rowLimit = Math.max(14, lineX.x1 - lineX.x0 + 6);
  const perRow = Math.max(1, Math.floor((rowLimit + 0.6) / rackPitch));
  const frontRacks = Math.min(rowRacks, Math.max(lines === 1 ? 1 : 2, perRow - Math.ceil((params.docks * (rules.footprint.dock[0] + 0.6)) / rackPitch)));
  const backRacks = rowRacks - frontRacks;
  // One line: front racks on the free side (away from the belt); more lines: split around the main aisle.
  const left = lines === 1 ? frontRacks : Math.ceil(frontRacks / 2);
  const kinds: EquipmentKind[] = [...Array(left).fill("rack"), ...Array(params.docks).fill("dock"), ...Array(frontRacks - left).fill("rack")];
  const widthOf = (list: EquipmentKind[]) => list.reduce((sum, kind) => sum + rules.footprint[kind][0] + 0.6, 0);
  // Centre the docks on the main aisle.
  let cursor = aisleX - widthOf(kinds.slice(0, left)) - (widthOf(kinds.slice(left, left + params.docks)) - 0.6) / 2;
  // Row next to the inlet when the row and its cross aisle clear every belt; otherwise below the belt heads.
  const rowX0 = cursor, rowX1 = cursor + widthOf(kinds) - 0.6;
  const besideZ = firstRobotZ - rules.robotPitch / 2 - aisle - DOCK_EDGE;
  // Band covers the row and the cross aisle that must reach every unit.
  const multi = lines > perUnit;
  const bandX0 = multi ? Math.min(rowX0, lineX.x0 - 1) : rowX0, bandX1 = multi ? Math.max(rowX1, lineX.x1 + 1) : rowX1;
  const band: Rect = { cx: (bandX0 + bandX1) / 2, cz: besideZ + (aisle - 0.4) / 2, yaw: 0, w: bandX1 - bandX0, d: aisle + 2.1, tag: "row" };
  const clearOfBelts = items.every((it, i) => (it.kind !== "conveyor" && it.kind !== "scanner") || !rectsOverlap(band, rectOf(it, i), rules.gap));
  const rowZ = clearOfBelts ? besideZ : Math.min(besideZ, headZ - 0.6 - aisle - DOCK_EDGE);
  for (const kind of kinds) {
    const [w] = rules.footprint[kind];
    destinations.push(items.length);
    (kind === "rack" ? rackItems : dockItems).push(items.length);
    // Rack front (local +z) faces the line (+z) so AMRs approach from the cross aisle.
    items.push({ kind, x: cursor + w / 2, z: rowZ - (kind === "rack" ? 0.4 : 0), yaw: kind === "rack" ? RACK_FACE_YAW : 0 });
    cursor += w + 0.6;
  }
  // Back rack rows, centred under the front row; each faces +z with an access aisle in front of it.
  const rowPitch = rackRowPitch;
  const rowCentre = (rowX0 + cursor - 0.6) / 2;
  for (let row = 1, placed = 0; placed < backRacks; row++) {
    const n = Math.min(perRow, backRacks - placed);
    const z = rowZ - 0.4 - row * rowPitch;
    let x = rowCentre - (n * rackPitch - 0.6) / 2;
    for (let k = 0; k < n; k++) {
      destinations.push(items.length); rackItems.push(items.length);
      items.push({ kind: "rack", x: x + rules.footprint.rack[0] / 2, z, yaw: RACK_FACE_YAW });
      x += rackPitch;
    }
    aisles.push({ cx: rowCentre, cz: z + rules.footprint.rack[1] / 2 + 0.15 + rackAccess / 2, yaw: 0, w: n * rackPitch, d: rackAccess, tag: "aisle" });
    placed += n;
  }
  // Cross aisle along the row, extended so AMRs reach every unit's aisle.
  const crossX0 = Math.min(rowX0, lines > perUnit ? lineX.x0 : rowX0), crossX1 = Math.max(cursor - 0.6, lines > perUnit ? lineX.x1 : rowX0);
  aisles.push({ cx: (crossX0 + crossX1) / 2, cz: rowZ + DOCK_EDGE + aisle / 2, yaw: 0, w: Math.max(aisle, crossX1 - crossX0), d: aisle, tag: "aisle" });
  // Aisle from the dock row to the first robot.
  aisles.push({ cx: aisleX, cz: (rowZ + DOCK_EDGE + firstRobotZ) / 2, yaw: 0, w: aisle, d: firstRobotZ - rowZ - DOCK_EDGE, tag: "aisle" });
  const amrs: number[] = [];
  for (let k = 0; k < params.amrs; k++) {
    amrs.push(items.length);
    items.push({ kind: "amr", x: aisleX, z: rowZ + DOCK_EDGE + AMR_PITCH / 2 + k * AMR_PITCH, yaw: 0 });
  }

  // Place in the floor: rotate so the dock end faces the door wall, then centre (or align to the door).
  const door = constraints.door;
  const wall = facing;
  const rotation = { south: 0, north: Math.PI, west: -Math.PI / 2, east: Math.PI / 2 }[wall];
  const rotate = (x: number, z: number) => ({ x: x * Math.cos(rotation) + z * Math.sin(rotation), z: -x * Math.sin(rotation) + z * Math.cos(rotation) });
  for (const item of items) { const p = rotate(item.x, item.z); item.x = p.x; item.z = p.z; item.yaw += rotation; }
  for (const a of aisles) { const p = rotate(a.cx, a.cz); a.cx = p.x; a.cz = p.z; a.yaw += rotation; }
  const rects = items.map(rectOf);
  const box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const r of [rects, aisles]) for (const rect of r) for (const p of corners(rect)) {
    if (p.x < box.x0) box.x0 = p.x; if (p.x > box.x1) box.x1 = p.x; if (p.z < box.z0) box.z0 = p.z; if (p.z > box.z1) box.z1 = p.z;
  }
  const W = Math.ceil(constraints.width), D = Math.ceil(constraints.depth), clear = constraints.wallClearance ?? rules.wallClearance;
  let dx = -(box.x0 + box.x1) / 2, dz = -(box.z0 + box.z1) / 2;
  // Pull the dock end toward the door wall, leaving the door keep-out zone free.
  const pull = door ? rules.doorKeepOut + clear : clear;
  if (wall === "south") dz = -D / 2 + pull - box.z0;
  if (wall === "north") dz = D / 2 - pull - box.z1;
  if (wall === "west") dx = -W / 2 + pull - box.x0;
  if (wall === "east") dx = W / 2 - pull - box.x1;
  if (door?.offset !== undefined && (wall === "south" || wall === "north")) dx = door.offset - aisleCenterAfter(items, amrs, "x");
  if (door?.offset !== undefined && (wall === "east" || wall === "west")) dz = door.offset - aisleCenterAfter(items, amrs, "z");
  const round = (v: number) => Math.round(v * 1000) / 1000;
  for (const item of items) { item.x = round(item.x + dx); item.z = round(item.z + dz); item.yaw = round(((item.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)); }
  for (const r of rects) { r.cx += dx; r.cz += dz; }
  for (const a of aisles) { a.cx += dx; a.cz += dz; }
  const shifted = { x0: box.x0 + dx, x1: box.x1 + dx, z0: box.z0 + dz, z1: box.z1 + dz };
  if (shifted.x0 < -W / 2 + clear || shifted.x1 > W / 2 - clear || shifted.z0 < -D / 2 + clear || shifted.z1 > D / 2 - clear)
    issues.push(`레이아웃(${(box.x1 - box.x0).toFixed(1)}×${(box.z1 - box.z0).toFixed(1)}m)이 공장(${W}×${D}m, 벽 여유 ${clear}m)에 들어가지 않습니다.`);
  // Early exit: an infeasible footprint is never simulated, so skip the O(n²) overlap / spot / route checks.
  const usedArea = Math.round((box.x1 - box.x0) * (box.z1 - box.z0) * 10) / 10;
  if (issues.length) return {
    params, issues: [...new Set(issues)], crossings: 0, closeness: 0,
    template: { id: `auto-infeasible-${params.pattern}-${lines}`, name: `${params.pattern}×${lines}`, description: "", equipment: [], links: [] },
    counts: { robots: 0, pallets: 0, conveyors: 0, amrs: params.amrs, docks: params.docks, racks: params.racks, forklifts: 0 },
    storage: { slots: params.racks * RACK_SLOTS, required: storageRequirement(constraints).pallets }, travel: 0, rackDistance: 0, outbound: [], usedArea,
  };

  // Overlaps: equipment pairs (designed belt-robot-pallet neighbours are spaced by the rules above).
  const solid = rects.map((r, i) => ({ r, item: items[i] })).filter(({ item }) => item.kind !== "amr");
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const a = solid[i], b = solid[j];
    if (a.item.kind === "conveyor" && b.item.kind === "conveyor") continue;
    // The scan tunnel stands over the head of its line's first rail by design.
    if ((a.item.kind === "scanner" && b.item.kind === "conveyor") || (a.item.kind === "conveyor" && b.item.kind === "scanner")) continue;
    // Robot bases sit deliberately close to their belt and pallet (template spacing); others keep `gap`.
    const margin = a.item.kind === "robot" || b.item.kind === "robot" ? 0.05 : rules.gap;
    if (rectsOverlap(a.r, b.r, margin)) issues.push(`겹침: ${a.item.kind}#${a.r.index} - ${b.item.kind}#${b.r.index}`);
  }
  for (const a of aisles) for (const { r, item } of solid)
    if (item.kind !== "dock" && item.kind !== "rack" && rectsOverlap(a, { ...r, w: r.w - 0.02, d: r.d - 0.02 }, 0)) { issues.push(`통로 침범: ${item.kind}#${r.index}`); break; }
  const doorWidth = door?.width ?? 3, doorOffset = door?.offset ?? 0;
  const keep: Rect | null = !door ? null : wall === "south" || wall === "north"
    ? { cx: doorOffset, cz: (wall === "south" ? -1 : 1) * (D / 2 - rules.doorKeepOut / 2), yaw: 0, w: doorWidth + 1, d: rules.doorKeepOut, tag: "door" }
    : { cx: (wall === "west" ? -1 : 1) * (W / 2 - rules.doorKeepOut / 2), cz: doorOffset, yaw: 0, w: rules.doorKeepOut, d: doorWidth + 1, tag: "door" };
  if (keep) {
    for (const { r, item } of solid) if (rectsOverlap(keep, r, 0)) { issues.push(`문 앞 여유 공간 침범: ${item.kind}#${r.index}`); break; }
  }

  // R-GUARD: the door keep-out zone may not touch any robot envelope (reach circle, as its bounding square).
  if (keep) {
    for (const item of items) if (item.kind === "robot" && rectsOverlap(keep, { cx: item.x, cz: item.z, yaw: 0, w: 2 * reach, d: 2 * reach, tag: "envelope" }, 0)) { issues.push("로봇 작업 반경이 문 앞 통행 구역과 겹칩니다."); break; }
  }
  // R-CROSS: straight AMR legs (pallet -> rack store, rack -> dock retrieve; pallet -> dock without racks) crossing belts.
  // R-TRAVEL: mean store + retrieve leg length per pallet.
  const belts = items.filter((it) => it.kind === "conveyor").map((it) => [beltPoint(it, 0), beltPoint(it, beltLength(it))] as const);
  const nearest = (from: Item, pool: number[]) => pool.map((i) => items[i]).sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
  const dist = (a: Item, b: Item) => Math.hypot(a.x - b.x, a.z - b.z);
  let crossings = 0, travel = 0, rackDistance = 0;
  const palletItems = items.filter((it) => it.kind === "pallet");
  for (const pallet of palletItems) {
    const legs: [Item, Item][] = [];
    const rack = nearest(pallet, rackItems), dock = rack ? nearest(rack, dockItems) : nearest(pallet, dockItems);
    if (rack) { legs.push([pallet, rack]); rackDistance += dist(pallet, rack); }
    if (dock) legs.push([rack ?? pallet, dock]);
    for (const [a, b] of legs) { crossings += belts.filter(([p, q]) => segmentsCross(a, b, p, q)).length; travel += dist(a, b); }
  }
  travel = palletItems.length ? Math.round((travel / palletItems.length) * 10) / 10 : 0;
  rackDistance = palletItems.length ? Math.round((rackDistance / palletItems.length) * 10) / 10 : 0;
  // R-SLP: closeness of related equipment (door included as a point when given).
  const doorPoint = door ? [{ kind: "door" as EquipmentKind, ...{ south: { x: door.offset ?? 0, z: -D / 2 }, north: { x: door.offset ?? 0, z: D / 2 }, west: { x: -W / 2, z: door.offset ?? 0 }, east: { x: W / 2, z: door.offset ?? 0 } }[wall] }] : [];
  const closeness = Math.round(closenessCost([...items, ...doorPoint]) * 100) / 100;

  // Forklifts (mandatory) and the optional Rack_m + AGV buffer: free floor spots found by a ring search
  // around an anchor, clear of equipment, aisles, the door keep-out and each other. Not part of `amrs`.
  const extras: TemplateEquipment[] = [], extraRects: Rect[] = [];
  const [fw, fd] = rules.footprint.amr;
  const freeAt = (r: Rect) => {
    if (Math.abs(r.cx) > W / 2 - Math.max(r.w, r.d) / 2 - 0.2 || Math.abs(r.cz) > D / 2 - Math.max(r.w, r.d) / 2 - 0.2) return false;
    if (keep && rectsOverlap(keep, r, 0.3)) return false;
    for (const o of solid) if (rectsOverlap(o.r, r, rules.gap)) return false;
    for (const o of aisles) if (rectsOverlap(o, r, 0)) return false;
    for (const o of extraRects) if (rectsOverlap(o, r, rules.gap)) return false;
    for (const it of items) if (it.kind === "amr" && Math.hypot(it.x - r.cx, it.z - r.cz) < fw + rules.gap) return false;
    return true;
  };
  const findSpot = (x0: number, z0: number, w: number, d: number, yaw: number, maxRadius = 14): Rect | null => {
    const probe: Rect = { cx: x0, cz: z0, yaw, w, d, tag: "extra" };
    for (let radius = 0; radius <= maxRadius; radius += 0.5) {
      const steps = radius ? Math.ceil((2 * Math.PI * radius) / 0.5) : 1;
      for (let k = 0; k < steps; k++) {
        const t = (2 * Math.PI * k) / steps;
        probe.cx = Math.round((x0 + radius * Math.cos(t)) * 1000) / 1000;
        probe.cz = Math.round((z0 + radius * Math.sin(t)) * 1000) / 1000;
        if (freeAt(probe)) { const hit = { ...probe }; extraRects.push(hit); return hit; }
      }
    }
    return null;
  };
  const normYaw = (y: number) => Math.round((((y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 1000) / 1000;
  const lineYaw = normYaw(rotation);
  // Forklift mode: carrier (forklift holds the pallet for the robot) when AMRs are few for the cells, else service
  // (forklift re-loads pallets onto AMRs). Count: >= 1 per cell, plus more when pallet moves exceed one forklift's rate.
  const forkliftTask = forkliftModeFor(params.amrs, lines);
  const forkliftCount = forkliftsFor(constraints, lines);
  for (let k = 0; k < forkliftCount; k++) {
    const line = k % lines, ids = palletsOf[line];
    const ax = ids.reduce((sum, i) => sum + items[i].x, 0) / ids.length, az = ids.reduce((sum, i) => sum + items[i].z, 0) / ids.length;
    const spot = findSpot(ax, az, fw, fd, lineYaw);
    if (!spot) { issues.push("지게차를 둘 자리가 없습니다."); break; }
    extras.push({ kind: "amr", x: spot.cx, z: spot.cz, yaw: lineYaw, settings: { amrRole: "forklift", forkliftTask } });
  }
  // Rack outfeed with a door: one more forklift beside the door (rack -> outbound).
  if (door && keep) {
    const frame = { south: { ax: 1, az: 0, nx: 0, nz: 1 }, north: { ax: 1, az: 0, nx: 0, nz: -1 }, west: { ax: 0, az: 1, nx: 1, nz: 0 }, east: { ax: 0, az: 1, nx: -1, nz: 0 } }[wall];
    const origin = { south: { x: doorOffset, z: -D / 2 }, north: { x: doorOffset, z: D / 2 }, west: { x: -W / 2, z: doorOffset }, east: { x: W / 2, z: doorOffset } }[wall];
    const yaw = normYaw(Math.atan2(frame.nx, frame.nz));
    const spot = findSpot(origin.x + frame.ax * (doorWidth / 2 + 0.8 + fw / 2) + frame.nx * (clear + fd / 2), origin.z + frame.az * (doorWidth / 2 + 0.8 + fw / 2) + frame.nz * (clear + fd / 2), fw, fd, yaw);
    if (spot) extras.push({ kind: "amr", x: spot.cx, z: spot.cz, yaw, settings: { amrRole: "forklift", forkliftTask: "rack" } });
    else issues.push("지게차를 문 근처에 둘 자리가 없습니다.");
  }
  // Optional Rack_m + AGV: buffer pallets beside the line and move them in bulk, only when the main racks are far.
  let rackM = 0;
  if (rackItems.length && rackDistance >= RACK_M_MIN_DISTANCE) {
    const all = palletsOf.flat();
    const ax = all.reduce((sum, i) => sum + items[i].x, 0) / all.length, az = all.reduce((sum, i) => sum + items[i].z, 0) / all.length;
    const [rw, rd] = rules.footprint.rack;
    const rackSpot = findSpot(ax, az, rw, rd, lineYaw);
    const agvSpot = rackSpot && findSpot(rackSpot.cx, rackSpot.cz, fw, fd, lineYaw, 6);
    if (rackSpot && agvSpot) {
      extras.push({ kind: "rack", x: rackSpot.cx, z: rackSpot.cz, yaw: normYaw(lineYaw + RACK_FACE_YAW), settings: { rackType: "mobile" } });
      extras.push({ kind: "amr", x: agvSpot.cx, z: agvSpot.cz, yaw: lineYaw, settings: { amrRole: "agv" } });
      rackM = 1;
    }
  }
  const forklifts = extras.filter((e) => e.settings?.amrRole === "forklift").length;

  // Links: per line feed/load; AMRs serve every station; stations deliver to every dock/rack.
  const links: TemplateLink[] = [];
  const pallets = palletsOf.flat();
  for (let line = 0; line < lines; line++) robotsOf[line].forEach((robot, k) => {
    links.push({ type: "feed", from: headOf[line], to: robot }, { type: "load", from: robot, to: palletsOf[line][k] });
  });
  for (const amr of amrs) for (const pallet of pallets) links.push({ type: "pickup", from: amr, to: pallet });
  // Full pallets go to storage (racks); docks are kept for outbound (see `outbound`). Without racks they ship directly.
  for (const pallet of pallets) for (const destination of rackItems.length ? rackItems : dockItems) links.push({ type: "deliver", from: pallet, to: destination });

  const floor: TemplateEquipment = { kind: "floor", x: 0, z: 0, yaw: 0, floor: { width: W, depth: D, wallHeight: constraints.height ?? AUTO_LAYOUT_DEFAULTS.height } };
  const equipment: TemplateEquipment[] = [...items.map(({ line, ...rest }) => { void line; return rest.settings ? rest : (({ settings, ...bare }) => { void settings; return bare; })(rest); }), floor];
  if (door) {
    const offset = door.offset ?? 0, at = { south: { x: offset, z: -D / 2, yaw: 0 }, north: { x: offset, z: D / 2, yaw: Math.PI }, west: { x: -W / 2, z: offset, yaw: Math.PI / 2 }, east: { x: W / 2, z: offset, yaw: -Math.PI / 2 } }[wall];
    equipment.push({ kind: "door", ...at, settings: { doorWidth: door.width ?? 3 } });
  }
  equipment.push(...extras);
  const count = (kind: EquipmentKind) => items.filter((it) => it.kind === kind).length;
  const name = `${params.pattern}×${lines}${stack > 1 ? ` (${stack}단)` : ""} · 로봇 ${count("robot")} · AMR ${params.amrs} · 지게차 ${forklifts}${rackM ? " · Rack_m" : ""}${lineEnd ? " · 라인 끝 랙" : ""}`;
  return {
    params, issues: [...new Set(issues)], crossings, closeness,
    template: { id: `auto-${params.pattern}-${lines}-${count("robot")}r-s${stack}-${lineEnd ? "end" : "row"}-${params.amrs}-${params.docks}-${params.racks}`, name, description: constraints.mode === "fixed" ? "자동 배치 (고정 장비 · 최대 처리량)" : `자동 배치 (${constraints.targetPerHour}박스/h 목표)`, equipment, links },
    counts: { robots: count("robot"), pallets: count("pallet"), conveyors: count("conveyor"), amrs: params.amrs, docks: params.docks, racks: params.racks, forklifts, rackM },
    storage: { slots: params.racks * RACK_SLOTS, required: storageRequirement(constraints).pallets },
    travel, rackDistance,
    outbound: rackItems.map((rack) => ({ rack, dock: dockItems.length ? dockItems.reduce((best, d) => (dist(items[d], items[rack]) < dist(items[best], items[rack]) ? d : best)) : -1 })).filter((pair) => pair.dock >= 0),
    usedArea,
    fit: Math.round(Math.abs(Math.log(((box.x1 - box.x0) / Math.max(0.1, box.z1 - box.z0)) / (W / D))) * 100) / 100,
  };
}
function aisleCenterAfter(items: Item[], amrs: number[], axis: "x" | "z") {
  return amrs.length ? items[amrs[0]][axis] : 0;
}

export type SimMetrics = {
  /** Steady-state placed boxes per hour (after warm-up). */
  placedPerHour: number;
  /** Boxes that left the line unpicked, per hour. */
  passedPerHour: number;
  /** Mean fraction of time a full pallet waited for an AMR. */
  palletWaitShare: number;
  /** Mean robot busy share. */
  robotUtilization: number;
};
/** Lower is better. Unmet throughput dominates; then equipment cost, area and AMR waiting. */
export function scoreLayout(candidate: LayoutCandidate, metrics: SimMetrics, targetPerHour: number) {
  const shortfall = Math.max(0, targetPerHour - metrics.placedPerHour) / targetPerHour;
  const c = candidate.counts;
  const cost = c.robots * 10 + c.amrs * 6 + c.forklifts * 5 + (c.rackM ?? 0) * 8 + c.racks * 4 + c.docks * 2 + c.conveyors * 0.5;
  // R-RATE (shortfall, cost, area), R-PALLET-CHANGE (pallet wait), R-CROSS, R-SLP.
  // R-STORAGE: missing rack capacity; R-TRAVEL: AMR metres per pallet (store + retrieve).
  // R-LINE-LEN: one belt feeding many robots starves the downstream ones and makes a long, thin layout;
  // beyond 6 robots per line, parallel lines are preferred. R-FIT: layout aspect close to the floor's.
  const perLine = c.robots / Math.max(1, candidate.params.lines);
  const lineLength = Math.max(0, perLine - 6) * 8;
  const fit = candidate.fit ?? 0;
  const storageShortfall = Math.max(0, candidate.storage.required - candidate.storage.slots) / Math.max(1, candidate.storage.required);
  return Math.round((shortfall * 1000 + storageShortfall * 200 + candidate.travel * 0.3 + cost + candidate.usedArea * 0.02 + metrics.palletWaitShare * 20 + metrics.passedPerHour * 0.05
    + candidate.crossings * 5 + candidate.closeness * 0.5 + lineLength + fit * 10 + candidate.rackDistance * 2) * 10) / 10;
}
/**
 * Fixed-equipment mode, lower is better: throughput dominates (negated boxes/h); then short AMR routes
 * (R-NEAR pallet -> rack, R-TRAVEL store + retrieve), crossings, pallet waiting and a little area.
 */
export function scoreFixed(candidate: LayoutCandidate, metrics: SimMetrics) {
  return Math.round((-metrics.placedPerHour + candidate.rackDistance * 15 + candidate.travel * 4 + candidate.crossings * 15
    + metrics.palletWaitShare * 200 + candidate.usedArea * 0.01) * 10) / 10;
}
/** Per-line inlet cap (boxes/h) seen in the sim: ~1 box / 2 s per belt inlet. */
export const LINE_RATE_CAP = 1800;
/** Candidate parameter grid for a constraint set (search seeds; the caller grows/trims with simulation). */
/** Rough single-robot rate (boxes/h), used to size the seeds. */
export const ROBOT_RATE_ESTIMATE = 220;
/**
 * Seeds: every pattern with 1..N parallel lines, N scaled to the robots the target needs (more lines for a big
 * target/floor). Each seed starts at about the robots needed, split over its lines, so the search compares
 * genuinely different topologies (1 long line vs several parallel cells) instead of always growing one line.
 */
export function seedParams(constraints: LayoutConstraints): LayoutParams[] {
  const seeds: LayoutParams[] = [];
  const maxRobots = constraints.maxRobots ?? 24;
  const need = Math.max(1, Math.min(maxRobots, Math.ceil(constraints.targetPerHour / ROBOT_RATE_ESTIMATE)));
  const racks = storageRequirement(constraints).racks;
  const minPer = { straight: 1, L: 2, U: 3 } as const;
  for (const pattern of ["straight", "L", "U"] as const) {
    const lineOptions = new Set<number>([1, 2]);
    for (const per of [6, 4, 3]) lineOptions.add(Math.ceil(need / per));
    for (const lines of [...lineOptions].filter((n) => n >= 1 && n <= 8 && n * minPer[pattern] <= maxRobots).sort((a, b) => a - b)) {
      const robotsPerLine = Math.max(minPer[pattern], Math.min(Math.floor(maxRobots / lines), Math.ceil(need / lines) - 1));
      seeds.push({ pattern, lines, robotsPerLine, amrs: Math.max(1, Math.min(constraints.maxAmrs ?? 6, Math.ceil(lines / 2))), docks: 1, racks });
    }
  }
  return seeds;
}
