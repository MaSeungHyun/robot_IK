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
  /** Straight pattern only: 1 line, or 2 mirrored lines sharing one aisle. */
  lines: 1 | 2;
  /** Robots per line (each robot gets its own pallet station). */
  robotsPerLine: number;
  amrs: number;
  docks: number;
  racks: number;
  /** Seconds between boxes per line inlet; default derives from the target. */
  spawnInterval?: number;
};
export type LayoutCandidate = {
  params: LayoutParams;
  template: SceneTemplate;
  /** Geometry problems; a candidate with issues should not be simulated. */
  issues: string[];
  /** R-CROSS: pallet->dock straight routes that cross a conveyor. */
  crossings: number;
  /** R-SLP closeness cost (lower = related equipment closer, X pairs apart). */
  closeness: number;
  counts: Record<"robots" | "pallets" | "conveyors" | "amrs" | "docks" | "racks", number>;
  /** R-STORAGE: rack slots placed vs pallets that must be stored. */
  storage: { slots: number; required: number };
  /** R-TRAVEL: mean straight-line AMR metres per pallet for store (pallet->rack) + retrieve (rack->dock/door). */
  travel: number;
  /**
   * Outbound hook (not simulated yet): rack -> dock pairs for a future release step (rack -> AMR -> dock/door).
   * Indices into template.equipment.
   */
  outbound: { rack: number; dock: number }[];
  /** Area (m^2) of the equipment + aisle bounding box. */
  usedArea: number;
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
  if (constraints.door) return buildFacing(constraints, params, constraints.door.wall);
  // No door: try the line along both floor axes; keep the one with fewer issues (fit first), then smaller area.
  const options = (["south", "west"] as Wall[]).map((wall) => buildFacing(constraints, params, wall));
  return options.sort((a, b) => a.issues.length - b.issues.length || a.usedArea - b.usedArea)[0];
}
function buildFacing(constraints: LayoutConstraints, params: LayoutParams, facing: Wall): LayoutCandidate {
  const rules = LAYOUT_RULES, aisle = constraints.aisle ?? rules.aisle, reach = constraints.reach ?? 1.8;
  const issues: string[] = [];
  const lines = params.pattern === "straight" ? params.lines : 1;
  const interval = params.spawnInterval ?? (3600 * lines) / constraints.targetPerHour;
  const items: Item[] = [];
  const robotsOf: number[][] = [], palletsOf: number[][] = [], headOf: number[] = [];
  const aisles: Rect[] = [];
  const palletOuter = rules.beltToRobot + rules.robotToPallet + 0.55;
  // Belt x of each line in the local frame (line 0 at x = 0). Line 1 mirrors toward line 0's aisle.
  for (let line = 0; line < lines; line++) {
    const side = line === 0 ? -1 : 1;
    const start = { x: line === 0 ? 0 : -(2 * palletOuter + aisle), z: 0, yaw: 0, conveyorTurn: "straight" as ConveyorTurn };
    const beltSpeed = Math.max(rules.minBeltSpeed, 0.6 / interval);
    const chain = chainFor(params.pattern, params.robotsPerLine, inletSegments(beltSpeed, rules.robotPitch));
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
  // Dock / rack row at the upstream end, below every conveyor head, with a cross aisle in front (R-AISLE).
  // Docks sit at the main aisle (shortest pallet route), racks split to both sides (R-STORAGE, R-SLP).
  const firstRobotZ = Math.min(...items.filter((it) => it.kind === "robot").map((it) => it.z));
  const headZ = Math.min(...items.filter((it) => it.kind === "conveyor").map((it) => it.z)) - rules.robotPitch / 2;
  const aisleX = -(palletOuter + aisle / 2);
  const destinations: number[] = [], rackItems: number[] = [], dockItems: number[] = [];
  // One line: every rack on the free side (away from the belt); two lines: split around the shared aisle.
  const left = lines === 1 ? params.racks : Math.ceil(params.racks / 2);
  const kinds: EquipmentKind[] = [...Array(left).fill("rack"), ...Array(params.docks).fill("dock"), ...Array(params.racks - left).fill("rack")];
  const widthOf = (list: EquipmentKind[]) => list.reduce((sum, kind) => sum + rules.footprint[kind][0] + 0.6, 0);
  // Centre the docks on the main aisle.
  let cursor = aisleX - widthOf(kinds.slice(0, left)) - (widthOf(kinds.slice(left, left + params.docks)) - 0.6) / 2;
  // Row next to the inlet when the row and its cross aisle clear every belt; otherwise below the belt heads.
  const rowX0 = cursor, rowX1 = cursor + widthOf(kinds) - 0.6;
  const besideZ = firstRobotZ - rules.robotPitch / 2 - aisle - 1.0;
  const band: Rect = { cx: (rowX0 + rowX1) / 2, cz: besideZ + (aisle - 0.4) / 2, yaw: 0, w: rowX1 - rowX0, d: aisle + 2.1, tag: "row" };
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
  aisles.push({ cx: (rowX0 + cursor - 0.6) / 2, cz: rowZ + 0.85 + aisle / 2, yaw: 0, w: Math.max(aisle, cursor - 0.6 - rowX0), d: aisle, tag: "aisle" });
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
  // R-CROSS: straight AMR legs (pallet -> rack store, rack -> dock retrieve; pallet -> dock without racks) crossing belts.
  // R-TRAVEL: mean store + retrieve leg length per pallet.
  const belts = items.filter((it) => it.kind === "conveyor").map((it) => [beltPoint(it, 0), beltPoint(it, beltLength(it))] as const);
  const nearest = (from: Item, pool: number[]) => pool.map((i) => items[i]).sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
  const dist = (a: Item, b: Item) => Math.hypot(a.x - b.x, a.z - b.z);
  let crossings = 0, travel = 0;
  const palletItems = items.filter((it) => it.kind === "pallet");
  for (const pallet of palletItems) {
    const legs: [Item, Item][] = [];
    const rack = nearest(pallet, rackItems), dock = rack ? nearest(rack, dockItems) : nearest(pallet, dockItems);
    if (rack) legs.push([pallet, rack]);
    if (dock) legs.push([rack ?? pallet, dock]);
    for (const [a, b] of legs) { crossings += belts.filter(([p, q]) => segmentsCross(a, b, p, q)).length; travel += dist(a, b); }
  }
  travel = palletItems.length ? Math.round((travel / palletItems.length) * 10) / 10 : 0;
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
  }
  const count = (kind: EquipmentKind) => items.filter((it) => it.kind === kind).length;
  const name = `${params.pattern}${params.pattern === "straight" ? `×${lines}` : ""} · 로봇 ${count("robot")} · AMR ${params.amrs}`;
  return {
    params, issues: [...new Set(issues)], crossings, closeness,
    template: { id: `auto-${params.pattern}-${lines}-${params.robotsPerLine}-${params.amrs}-${params.docks}-${params.racks}`, name, description: `자동 배치 (${constraints.targetPerHour}박스/h 목표)`, equipment, links },
    counts: { robots: count("robot"), pallets: count("pallet"), conveyors: count("conveyor"), amrs: params.amrs, docks: params.docks, racks: params.racks },
    storage: { slots: params.racks * RACK_SLOTS, required: storageRequirement(constraints).pallets },
    travel,
    outbound: rackItems.map((rack) => ({ rack, dock: dockItems.length ? dockItems.reduce((best, d) => (dist(items[d], items[rack]) < dist(items[best], items[rack]) ? d : best)) : -1 })).filter((pair) => pair.dock >= 0),
    usedArea: Math.round((box.x1 - box.x0) * (box.z1 - box.z0) * 10) / 10,
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
  const storageShortfall = Math.max(0, candidate.storage.required - candidate.storage.slots) / Math.max(1, candidate.storage.required);
  return Math.round((shortfall * 1000 + storageShortfall * 200 + candidate.travel * 0.3 + cost + candidate.usedArea * 0.02 + metrics.palletWaitShare * 20 + metrics.passedPerHour * 0.05
    + candidate.crossings * 5 + candidate.closeness * 0.5) * 10) / 10;
}
/** Candidate parameter grid for a constraint set (search seeds; the caller grows/trims with simulation). */
export function seedParams(constraints: LayoutConstraints): LayoutParams[] {
  const seeds: LayoutParams[] = [];
  for (const pattern of ["straight", "L", "U"] as const)
    for (const lines of (pattern === "straight" ? [1, 2] : [1]) as (1 | 2)[])
      seeds.push({ pattern, lines, robotsPerLine: pattern === "U" ? 3 : pattern === "L" ? 2 : 1, amrs: 1, docks: 1, racks: storageRequirement(constraints).racks });
  return seeds;
}
