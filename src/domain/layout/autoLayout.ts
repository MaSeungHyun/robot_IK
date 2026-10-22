/**
 * Auto layout (step 1): pure geometry for generating palletizing-line layouts from constraints.
 * No three.js / DOM / store imports, so it can run in a Web Worker. Simulation-based scoring lives
 * in the caller (scripts/auto-layout.mjs today; a worker later) and is combined via `scoreLayout`.
 *
 * Frame: the floor is centred on (0, 0); width runs along x, depth along z. A conveyor at yaw 0
 * flows toward +z (see conveyorLayout.beltLocalPoint).
 */
import { CONVEYOR_LAYOUT as BELT } from "@/constants/conveyorLayoutConfig";
import { beltLength, beltPoint, extendBelt } from "@/domain/conveyor/conveyorLayout";
import type { ConveyorTurn, EquipmentKind, EquipmentSettings } from "@/types/layout";
import type { TemplateLink } from "@/types/links";
import type { SceneTemplate, TemplateEquipment } from "@/types/sceneTemplate";
import { aisleWidth, closenessCost, inletSegments, segmentsCross } from "@/domain/layout/designRules";

/** Drop-in animation when an auto-layout is applied: linear fall time (ms) and start height (m). */
export const AUTO_LAYOUT_DROP_IN_DURATION_MS = 300;
export const AUTO_LAYOUT_DROP_IN_HEIGHT = 2.5;
export const AUTO_LAYOUT_DROP_IN_STAGGER_MS = 65;

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
/** Rack slots (PalletPoints) per rack, from RACK_CONFIG.slots. */
export const RACK_SLOTS = 8;
/** R-STORAGE: pallets to store and racks needed for them (racks capped by maxRacks). */
export function storageRequirement(constraints: LayoutConstraints) {
  const perPallet = constraints.boxesPerPallet ?? 40;
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
   * R-NEAR: "lineEnd" puts each unit's racks right past its line output (short pallet -> rack AMR legs);
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
    rackAmrs: number;
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
export const LAYOUT_RULES = {
  beltToRobot: 1.07,
  robotToPallet: 1.0,
  robotPitch: BELT.length,
  /** R-AISLE: loaded AMR envelope + ISO 3691-4 0.5 m each side. */
  aisle: aisleWidth(),
  /** R-WALL. */
  wallClearance: 0.5,
  /** Gap kept between unrelated footprints. */
  gap: 0.15,
  doorKeepOut: 3,
  footprint: {
    conveyor: [BELT.width, BELT.length], pallet: [1.1, 1.1], dock: [1.3, 1.3], rack: [2.7, 1.7],
    robot: [0.65, 0.65], amr: [0.9, 0.9], scanner: [0.65, 0.65], floor: [0, 0], door: [0, 0],
  } as Record<EquipmentKind, [number, number]>,
  /** Belt speed so boxes (0.275 m) keep >= 0.5 m spacing at the inlet. */
  minBeltSpeed: 0.1875,
};

type Rect = { cx: number; cz: number; yaw: number; w: number; d: number; tag: string; index?: number };
type Item = TemplateEquipment & { line?: number };

const DIR = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
/** Unit normal to the flow (x, z) = (cos, -sin): +1 side is +x for a belt at yaw 0. */
const NORMAL = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

function rectOf(item: Item, index: number): Rect {
  const [w, d] = LAYOUT_RULES.footprint[item.kind];
  if (item.kind === "conveyor" && item.conveyorTurn && item.conveyorTurn !== "straight") {
    // Quarter turn: bounding square of the arc (centre of the arc's chord box).
    const mid = beltPoint(item, beltLength(item) / 2);
    const size = BELT.radius + BELT.width;
    return { cx: mid.x, cz: mid.z, yaw: item.yaw, w: size, d: size, tag: "conveyor-turn", index };
  }
  return { cx: item.x, cz: item.z, yaw: item.yaw, w, d, tag: item.kind, index };
}
function corners(r: Rect) {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const lx = (a * r.w) / 2, lz = (b * r.d) / 2;
    return { x: r.cx + lx * c + lz * s, z: r.cz - lx * s + lz * c };
  });
}
/** Separating-axis overlap test with a margin. */
export function rectsOverlap(a: Rect, b: Rect, margin = 0) {
  for (const yaw of [a.yaw, b.yaw]) for (const axis of [DIR(yaw), NORMAL(yaw)]) {
    const project = (r: Rect) => {
      const values = corners(r).map((p) => p.x * axis.x + p.z * axis.z);
      return [Math.min(...values), Math.max(...values)];
    };
    const [a0, a1] = project(a), [b0, b1] = project(b);
    if (a1 + margin <= b0 || b1 + margin <= a0) return false;
  }
  return true;
}

type Segment = { turn: ConveyorTurn; robot: boolean };
/** Conveyor chain for a pattern; robots sit beside straight segments, on the outside of turns. */
function chainFor(pattern: LayoutPattern, robots: number, inlet = 1): Segment[] {
  const straight = (n: number, withRobots: number) =>
    Array.from({ length: n }, (_, i) => ({ turn: "straight" as const, robot: i >= inlet && i < inlet + withRobots }));
  if (pattern === "straight") return [...straight(robots + inlet, robots), { turn: "straight", robot: false }];
  const first = Math.ceil(robots / (pattern === "L" ? 2 : 3)), last = pattern === "L" ? robots - first : Math.ceil((robots - first) / 2);
  const legs = pattern === "L" ? [first, last] : [first, robots - first - last, last];
  const chain: Segment[] = [];
  legs.forEach((count, leg) => {
    if (leg) chain.push({ turn: "right", robot: false });
    // First leg keeps one empty inlet segment; later legs one segment after the turn to clear the arc.
    // R-BUFFER: the first leg starts with `inlet` empty accumulation segments.
    const lead = leg ? 1 : inlet;
    chain.push(...Array.from({ length: count + lead }, (_, i) => ({ turn: "straight" as const, robot: i >= lead })));
  });
  chain.push({ turn: "straight", robot: false });
  return chain;
}

function settingsFor(kind: EquipmentKind, interval: number): Partial<EquipmentSettings> | undefined {
  if (kind !== "conveyor") return undefined;
  return { spawnInterval: +interval.toFixed(3), beltSpeed: +Math.max(LAYOUT_RULES.minBeltSpeed, 0.6 / interval).toFixed(4) };
}

/**
 * Builds one candidate. Robots on side -1 (left of the flow; outside of right turns) unless the line is the
 * mirrored second line of a straight pair. Docks/racks sit at the upstream end of the aisle, toward the door.
 */
export function buildLayout(constraints: LayoutConstraints, params: LayoutParams): LayoutCandidate {
  if (params.rackPlacement) return buildOriented(constraints, params);
  const variants: LayoutParams[] = [
    { ...params, rackPlacement: "lineEnd", stack: params.stack ?? 1 },
    ...(params.stack ? [] : [{ ...params, rackPlacement: "lineEnd" as const, stack: 2 }]),
    { ...params, rackPlacement: "row", stack: params.stack ?? 1 },
  ];
  let first: LayoutCandidate | null = null;
  for (const variant of variants) {
    const candidate = buildOriented(constraints, variant);
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
  const rules = LAYOUT_RULES, aisle = constraints.aisle ?? rules.aisle, reach = constraints.reach ?? 1.8;
  const issues: string[] = [];
  const lines = Math.max(1, Math.round(params.lines));
  const interval = params.spawnInterval ?? (3600 * lines) / constraints.targetPerHour;
  const items: Item[] = [];
  const robotsOf: number[][] = [], palletsOf: number[][] = [], headOf: number[] = [];
  const aisles: Rect[] = [];
  const palletOuter = rules.beltToRobot + rules.robotToPallet + 0.55;
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
  const rackRowPitch = rules.footprint.rack[1] + aisle + 0.3;
  const extraRackItems: number[] = [];
  const crossBands: { z: number }[] = [];
  let unitStartItem = 0, unitStartAisle = 0, unitMaxX = -Infinity, baseX0: number | null = null;
  let rowMaxZ = -Infinity, zBase = 0;
  const extent = (from: number, fromAisle: number) => {
    const pts = [...items.slice(from).map((it, k) => rectOf(it, from + k)), ...aisles.slice(fromAisle)].flatMap(corners);
    return { x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)), z0: Math.min(...pts.map((q) => q.z)), z1: Math.max(...pts.map((q) => q.z)) };
  };
  // R-NEAR: the unit's racks sit just past its line output, fronts facing the line, reached from the unit aisle.
  const placeUnitRacks = (count: number) => {
    const lineAisles = aisles.slice(unitStartAisle);
    const ext = extent(unitStartItem, unitStartAisle);
    const cx = lineAisles.length ? lineAisles.reduce((sum, a) => sum + a.cx, 0) / lineAisles.length : (ext.x0 + ext.x1) / 2;
    const perRow = Math.max(1, Math.floor((ext.x1 - ext.x0 + 0.6) / rackPitch));
    for (let row = 0, placed = 0; placed < count; row++) {
      const n = Math.min(perRow, count - placed);
      const front = ext.z1 + aisle + 0.2 + row * rackRowPitch;
      let x = cx - (n * rackPitch - 0.6) / 2;
      aisles.push({ cx, cz: front - (aisle + 0.2) / 2, yaw: 0, w: Math.max(aisle, n * rackPitch), d: aisle, tag: "aisle" });
      for (let k = 0; k < n; k++) {
        extraRackItems.push(items.length);
        items.push({ kind: "rack", x: x + rules.footprint.rack[0] / 2, z: front + rules.footprint.rack[1] / 2, yaw: Math.PI });
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
    const beltSpeed = Math.max(rules.minBeltSpeed, 0.6 / interval);
    const chain = chainFor(params.pattern, robotsForLine(line), inletSegments(beltSpeed, rules.robotPitch));
    let pose = start;
    robotsOf[line] = []; palletsOf[line] = [];
    chain.forEach((segment, i) => {
      if (i) pose = { ...extendBelt(pose, segment.turn), conveyorTurn: segment.turn };
      headOf[line] ??= items.length;
      items.push({ kind: "conveyor", x: pose.x, z: pose.z, yaw: pose.yaw, ...(segment.turn !== "straight" ? { conveyorTurn: segment.turn } : {}), settings: i ? undefined : settingsFor("conveyor", interval), line });
      if (!segment.robot) return;
      const n = NORMAL(pose.yaw);
      const at = (distance: number) => ({ x: pose.x + side * n.x * distance, z: pose.z + side * n.z * distance });
      const robot = at(rules.beltToRobot), pallet = at(rules.beltToRobot + rules.robotToPallet);
      robotsOf[line].push(items.length);
      items.push({ kind: "robot", ...robot, yaw: pose.yaw, line });
      palletsOf[line].push(items.length);
      items.push({ kind: "pallet", ...pallet, yaw: pose.yaw, line });
      const aisleCentre = at(palletOuter + aisle / 2);
      aisles.push({ cx: aisleCentre.x, cz: aisleCentre.z, yaw: pose.yaw, w: aisle, d: rules.robotPitch + 0.01, tag: "aisle" });
      // Reach check: belt centre line and the far pallet corners.
      const far = Math.hypot(rules.robotToPallet + 0.55, 0.55);
      if (rules.beltToRobot > reach || far > reach) issues.push(`로봇 작업 반경(${reach}m) 밖에 컨베이어/팔레트가 있습니다.`);
    });
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
  const headZ = Math.min(...items.filter((it) => it.kind === "conveyor").map((it) => it.z)) - rules.robotPitch / 2;
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
  const besideZ = firstRobotZ - rules.robotPitch / 2 - aisle - 1.0;
  // Band covers the row and the cross aisle that must reach every unit.
  const multi = lines > perUnit;
  const bandX0 = multi ? Math.min(rowX0, lineX.x0 - 1) : rowX0, bandX1 = multi ? Math.max(rowX1, lineX.x1 + 1) : rowX1;
  const band: Rect = { cx: (bandX0 + bandX1) / 2, cz: besideZ + (aisle - 0.4) / 2, yaw: 0, w: bandX1 - bandX0, d: aisle + 2.1, tag: "row" };
  const clearOfBelts = items.every((it, i) => it.kind !== "conveyor" || !rectsOverlap(band, rectOf(it, i), rules.gap));
  const rowZ = clearOfBelts ? besideZ : Math.min(besideZ, headZ - 0.6 - aisle - 0.85);
  for (const kind of kinds) {
    const [w] = rules.footprint[kind];
    destinations.push(items.length);
    (kind === "rack" ? rackItems : dockItems).push(items.length);
    // Rack front (local +z) faces the line (+z) so AMRs approach from the cross aisle.
    items.push({ kind, x: cursor + w / 2, z: rowZ - (kind === "rack" ? 0.4 : 0), yaw: 0 });
    cursor += w + 0.6;
  }
  // Back rack rows, centred under the front row; each faces +z with an access aisle in front of it.
  const rowPitch = rules.footprint.rack[1] + aisle + 0.3;
  const rowCentre = (rowX0 + cursor - 0.6) / 2;
  for (let row = 1, placed = 0; placed < backRacks; row++) {
    const n = Math.min(perRow, backRacks - placed);
    const z = rowZ - 0.4 - row * rowPitch;
    let x = rowCentre - (n * rackPitch - 0.6) / 2;
    for (let k = 0; k < n; k++) {
      destinations.push(items.length); rackItems.push(items.length);
      items.push({ kind: "rack", x: x + rules.footprint.rack[0] / 2, z, yaw: 0 });
      x += rackPitch;
    }
    aisles.push({ cx: rowCentre, cz: z + rules.footprint.rack[1] / 2 + 0.15 + (aisle - 0.2) / 2, yaw: 0, w: n * rackPitch, d: aisle - 0.2, tag: "aisle" });
    placed += n;
  }
  // Cross aisle along the row, extended so AMRs reach every unit's aisle.
  const crossX0 = Math.min(rowX0, lines > perUnit ? lineX.x0 : rowX0), crossX1 = Math.max(cursor - 0.6, lines > perUnit ? lineX.x1 : rowX0);
  aisles.push({ cx: (crossX0 + crossX1) / 2, cz: rowZ + 0.85 + aisle / 2, yaw: 0, w: Math.max(aisle, crossX1 - crossX0), d: aisle, tag: "aisle" });
  // Aisle from the dock row to the first robot.
  aisles.push({ cx: aisleX, cz: (rowZ + 0.85 + firstRobotZ) / 2, yaw: 0, w: aisle, d: firstRobotZ - rowZ - 0.85, tag: "aisle" });
  const amrs: number[] = [];
  for (let k = 0; k < params.amrs; k++) {
    amrs.push(items.length);
    items.push({ kind: "amr", x: aisleX, z: rowZ + 1.6 + k * 1.3, yaw: 0 });
  }

  // Place in the floor: rotate so the dock end faces the door wall, then centre (or align to the door).
  const door = constraints.door;
  const wall = facing;
  const rotation = { south: 0, north: Math.PI, west: -Math.PI / 2, east: Math.PI / 2 }[wall];
  const rotate = (x: number, z: number) => ({ x: x * Math.cos(rotation) + z * Math.sin(rotation), z: -x * Math.sin(rotation) + z * Math.cos(rotation) });
  for (const item of items) { const p = rotate(item.x, item.z); item.x = p.x; item.z = p.z; item.yaw += rotation; }
  for (const a of aisles) { const p = rotate(a.cx, a.cz); a.cx = p.x; a.cz = p.z; a.yaw += rotation; }
  const rects = items.map(rectOf);
  const all = [...rects, ...aisles].flatMap(corners);
  const box = { x0: Math.min(...all.map((p) => p.x)), x1: Math.max(...all.map((p) => p.x)), z0: Math.min(...all.map((p) => p.z)), z1: Math.max(...all.map((p) => p.z)) };
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

  // Overlaps: equipment pairs (designed belt-robot-pallet neighbours are spaced by the rules above).
  const solid = rects.map((r, i) => ({ r, item: items[i] })).filter(({ item }) => item.kind !== "amr");
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const a = solid[i], b = solid[j];
    if (a.item.kind === "conveyor" && b.item.kind === "conveyor") continue;
    // Robot bases sit deliberately close to their belt and pallet (template spacing); others keep `gap`.
    const margin = a.item.kind === "robot" || b.item.kind === "robot" ? 0.05 : rules.gap;
    if (rectsOverlap(a.r, b.r, margin)) issues.push(`겹침: ${a.item.kind}#${a.r.index} - ${b.item.kind}#${b.r.index}`);
  }
  for (const a of aisles) for (const { r, item } of solid)
    if (item.kind !== "dock" && item.kind !== "rack" && rectsOverlap(a, { ...r, w: r.w - 0.02, d: r.d - 0.02 }, 0)) { issues.push(`통로 침범: ${item.kind}#${r.index}`); break; }
  if (door) {
    const doorWidth = door.width ?? 3, offset = door.offset ?? 0;
    const keep: Rect = wall === "south" || wall === "north"
      ? { cx: offset, cz: (wall === "south" ? -1 : 1) * (D / 2 - rules.doorKeepOut / 2), yaw: 0, w: doorWidth + 1, d: rules.doorKeepOut, tag: "door" }
      : { cx: (wall === "west" ? -1 : 1) * (W / 2 - rules.doorKeepOut / 2), cz: offset, yaw: 0, w: rules.doorKeepOut, d: doorWidth + 1, tag: "door" };
    for (const { r, item } of solid) if (rectsOverlap(keep, r, 0)) { issues.push(`문 앞 여유 공간 침범: ${item.kind}#${r.index}`); break; }
  }

  // R-GUARD: the door keep-out zone may not touch any robot envelope (reach circle, as its bounding square).
  if (door) {
    const doorWidth = door.width ?? 3, offset = door.offset ?? 0;
    const keep: Rect = wall === "south" || wall === "north"
      ? { cx: offset, cz: (wall === "south" ? -1 : 1) * (D / 2 - rules.doorKeepOut / 2), yaw: 0, w: doorWidth + 1, d: rules.doorKeepOut, tag: "door" }
      : { cx: (wall === "west" ? -1 : 1) * (W / 2 - rules.doorKeepOut / 2), cz: offset, yaw: 0, w: rules.doorKeepOut, d: doorWidth + 1, tag: "door" };
    for (const item of items) if (item.kind === "robot" && rectsOverlap(keep, { cx: item.x, cz: item.z, yaw: 0, w: 2 * reach, d: 2 * reach, tag: "envelope" }, 0)) { issues.push("로봇 작업 반경이 문 앞 통행 구역과 겹칩니다."); break; }
  }
  // Rack outfeed: with a door, one dedicated rack-unloading AMR (amrRole "rack") waits inside beside the door,
  // clear of the door keep-out zone, the aisles and equipment. Not part of `amrs` / maxAmrs (it serves racks only).
  let rackAmr: TemplateEquipment | null = null;
  if (door) {
    const doorWidth = door.width ?? 3, offset = door.offset ?? 0;
    const frame = { south: { ax: 1, az: 0, nx: 0, nz: 1 }, north: { ax: 1, az: 0, nx: 0, nz: -1 }, west: { ax: 0, az: 1, nx: 1, nz: 0 }, east: { ax: 0, az: 1, nx: -1, nz: 0 } }[wall];
    const origin = { south: { x: offset, z: -D / 2 }, north: { x: offset, z: D / 2 }, west: { x: -W / 2, z: offset }, east: { x: W / 2, z: offset } }[wall];
    const keep: Rect = wall === "south" || wall === "north"
      ? { cx: offset, cz: (wall === "south" ? -1 : 1) * (D / 2 - rules.doorKeepOut / 2), yaw: 0, w: doorWidth + 1, d: rules.doorKeepOut, tag: "door" }
      : { cx: (wall === "west" ? -1 : 1) * (W / 2 - rules.doorKeepOut / 2), cz: offset, yaw: 0, w: rules.doorKeepOut, d: doorWidth + 1, tag: "door" };
    const [fw, fd] = rules.footprint.amr, yaw = Math.round(Math.atan2(frame.nx, frame.nz) * 1000) / 1000;
    const fits = (x: number, z: number) => {
      const r: Rect = { cx: x, cz: z, yaw, w: fw, d: fd, tag: "amr" };
      if (Math.abs(x) > W / 2 - fw / 2 - 0.2 || Math.abs(z) > D / 2 - fd / 2 - 0.2) return false;
      if (rectsOverlap(keep, r, 0.3)) return false;
      return solid.every(({ r: other }) => !rectsOverlap(other, r, rules.gap)) && aisles.every((a) => !rectsOverlap(a, r, 0)) &&
        items.every((it) => it.kind !== "amr" || Math.hypot(it.x - x, it.z - z) > fw + rules.gap);
    };
    // Nearest spot first: beside the keep-out zone along the wall, then deeper into the room.
    search: for (let along = doorWidth / 2 + 0.5 + fw / 2 + 0.3; along < Math.max(W, D); along += 0.5)
      for (let depth = clear + fd / 2; depth <= rules.doorKeepOut + 3; depth += 0.5)
        for (const side of [1, -1]) {
          const x = Math.round((origin.x + frame.ax * along * side + frame.nx * depth) * 1000) / 1000;
          const z = Math.round((origin.z + frame.az * along * side + frame.nz * depth) * 1000) / 1000;
          if (fits(x, z)) { rackAmr = { kind: "amr", x, z, yaw: ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), settings: { amrRole: "rack" } }; break search; }
        }
    if (!rackAmr) issues.push("랙 반출 AMR을 문 근처에 둘 자리가 없습니다.");
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

  // Links: per line feed/load; AMRs serve every station; stations deliver to every dock/rack.
  const links: TemplateLink[] = [];
  const pallets = palletsOf.flat();
  for (let line = 0; line < lines; line++) robotsOf[line].forEach((robot, k) => {
    links.push({ type: "feed", from: headOf[line], to: robot }, { type: "load", from: robot, to: palletsOf[line][k] });
  });
  for (const amr of amrs) for (const pallet of pallets) links.push({ type: "pickup", from: amr, to: pallet });
  // Full pallets go to storage (racks); docks are kept for outbound (see `outbound`). Without racks they ship directly.
  for (const pallet of pallets) for (const destination of rackItems.length ? rackItems : dockItems) links.push({ type: "deliver", from: pallet, to: destination });

  const floor: TemplateEquipment = { kind: "floor", x: 0, z: 0, yaw: 0, floor: { width: W, depth: D, wallHeight: constraints.height ?? 6 } };
  const equipment: TemplateEquipment[] = [...items.map(({ line, ...rest }) => { void line; return rest.settings ? rest : (({ settings, ...bare }) => { void settings; return bare; })(rest); }), floor];
  if (door) {
    const offset = door.offset ?? 0, at = { south: { x: offset, z: -D / 2, yaw: 0 }, north: { x: offset, z: D / 2, yaw: Math.PI }, west: { x: -W / 2, z: offset, yaw: Math.PI / 2 }, east: { x: W / 2, z: offset, yaw: -Math.PI / 2 } }[wall];
    equipment.push({ kind: "door", ...at, settings: { doorWidth: door.width ?? 3 } });
    if (rackAmr) equipment.push(rackAmr);
  }
  const count = (kind: EquipmentKind) => items.filter((it) => it.kind === kind).length;
  const name = `${params.pattern}×${lines}${stack > 1 ? ` (${stack}단)` : ""} · 로봇 ${count("robot")} · AMR ${params.amrs}${lineEnd ? " · 라인 끝 랙" : ""}`;
  return {
    params, issues: [...new Set(issues)], crossings, closeness,
    template: { id: `auto-${params.pattern}-${lines}-${count("robot")}r-s${stack}-${lineEnd ? "end" : "row"}-${params.amrs}-${params.docks}-${params.racks}`, name, description: constraints.mode === "fixed" ? "자동 배치 (고정 장비 · 최대 처리량)" : `자동 배치 (${constraints.targetPerHour}박스/h 목표)`, equipment, links },
    counts: { robots: count("robot"), pallets: count("pallet"), conveyors: count("conveyor"), amrs: params.amrs, docks: params.docks, racks: params.racks, rackAmrs: rackAmr ? 1 : 0 },
    storage: { slots: params.racks * RACK_SLOTS, required: storageRequirement(constraints).pallets },
    travel, rackDistance,
    outbound: rackItems.map((rack) => ({ rack, dock: dockItems.length ? dockItems.reduce((best, d) => (dist(items[d], items[rack]) < dist(items[best], items[rack]) ? d : best)) : -1 })).filter((pair) => pair.dock >= 0),
    usedArea: Math.round((box.x1 - box.x0) * (box.z1 - box.z0) * 10) / 10,
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
  const cost = c.robots * 10 + c.amrs * 6 + c.racks * 4 + c.docks * 2 + c.conveyors * 0.5;
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
