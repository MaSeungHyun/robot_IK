// SLP template generator: node scripts/generate-templates.mjs [--out=dir]
// Builds every scene template from measured constants (belt, tunnel, AMR, pallet, rack) and writes one JSON per
// template into src/constants/templates (see docs/template-slp-layout.md for the layout rules).
import { createServer } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const outDir = outArg ? outArg.slice(6) : "src/constants/templates";
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
try {
  const { CONVEYOR_LAYOUT: BELT } = await load("/src/constants/conveyorLayoutConfig.ts");
  const { SCAN_TUNNEL } = await load("/src/domain/conveyor/scanTunnel.ts");
  const { beltConnections } = await load("/src/domain/conveyor/conveyorLayout.ts");
  /** Belt end -> roller-top shuttle centre (half the AMR length + a small transfer gap). */
  const ROLLER_GAP = 0.95;
  const { LAYOUT_RULES: R } = await load("/src/domain/layout/autoLayout.ts");
  const { BOX_SIZES, STREAM_CONFIG } = await load("/src/constants/simulation.ts");
  const { AMR_TRAFFIC } = await load("/src/constants/simulatorLayout.ts");
  const { FACTORY_ROOM } = await load("/src/constants/factoryRoom.ts");

  const round = (v) => +v.toFixed(4);
  const firstSlot = R.robotPitch / 2;
  /** One AMR lane: loaded body diameter + safety margin. */
  const lane = 2 * (AMR_TRAFFIC.loadedRadius + AMR_TRAFFIC.safetyMargin);
  /** Belt centre -> outer edge of the pallet column (pallets outboard of the robots). */
  const palletEdge = R.beltToRobot + R.robotToPallet + STREAM_CONFIG.palletWidth / 2;
  /** Two-way aisle: lane 1 (pickup/drop side) and lane 2 (passing/return), both outside the pallet column. */
  const lane1 = palletEdge + lane / 2 + 0.05, lane2 = lane1 + lane;
  /** Aisle keep-out edge measured from the belt centre (nothing else is placed inside). */
  const aisleEdge = lane2 + lane / 2 + 0.15;

  /** Base yaw that turns the robot's front (model local +X) toward the point (bx, bz) on its belt. */
  const face = (rx, rz, bx, bz) => round(Math.atan2(-(bz - rz), bx - rx));
  /** Process unit builder: equipment + links with local indices; `@i` mount references resolve in compose(). */
  const unit = () => {
    const eq = [], links = [];
    const add = (e) => (eq.push(e), eq.length - 1);
    return { eq, links, add, id: (i) => `@${i}` };
  };
  const cellZ = (k) => round(SCAN_TUNNEL.exitDistance + firstSlot + k * R.robotPitch);
  const beltEndFor = (cells) => cellZ(cells - 1) + BOX_SIZES[0].z / 2;

  /**
   * Scan line (x = D): fed belt A chains into belt B with the scan tunnel at B's start. `fed`: A is fed by the
   * depalletizing robot R2 (west of A, facing it) from the AMR parked at its unload dock; otherwise B alone is a box source.
   */
  function scanLine(u, { D = 0, cells, fed = true, spawn = 6 }) {
    const bEnd = beltEndFor(cells), bStart = bEnd - BELT.length, aStart = bStart - BELT.length;
    if (fed) u.add({ kind: "conveyor", x: D, z: round(aStart + BELT.length / 2), yaw: 0, settings: { conveyorRole: "fed" } });
    u.add({ kind: "conveyor", x: D, z: round(bStart + BELT.length / 2), yaw: 0, ...(!fed && { settings: { spawnInterval: spawn } }) });
    u.add({ kind: "scanner", x: D, z: round(bStart + SCAN_TUNNEL.startOffset), yaw: 0 });
    let unload = -1;
    const unloadZ = round(bStart - 4);
    if (fed) {
      const rx = round(D - R.beltToRobot);
      u.add({ kind: "robot", x: rx, z: unloadZ, yaw: face(rx, unloadZ, D, unloadZ), settings: { robotRole: "depalletize" } });
      unload = u.add({ kind: "dock", x: round(D - R.beltToRobot - R.robotToPallet), z: unloadZ, yaw: 0, settings: { dockRole: "unload" } });
    }
    return { bEnd, bStart, aStart: fed ? aStart : bStart, unload, unloadZ };
  }

  /**
   * Pallet infeed (west of the scan line): the inbound belt runs loaded pallets straight onto the roller-top shuttle
   * AMR (parked feedPark m west of the belt end, linked by a feed link). The shuttle docks at the unload dock beside
   * R2, waits there until R2 has put every box on the fed belt, the service forklift lifts the empty pallet off onto
   * the empty-pallet stack (palletSource) and the shuttle drives back for the next pallet.
   */
  function palletInfeed(u, { D = 0, line, capacity = 4, palletSpawn = 60, feedPark = 3 }) {
    const p1x = D - aisleEdge - STREAM_CONFIG.palletWidth / 2 - 0.1;
    const r1z = round(line.unloadZ + 2 - BOX_SIZES[0].z / 2);
    const belt = u.add({ kind: "conveyor", x: round(p1x), z: round(r1z - ROLLER_GAP - BELT.length / 2), yaw: 0, settings: { conveyorRole: "inbound", inboundUnit: "pallet", spawnInterval: palletSpawn } });
    const ax = round(p1x - feedPark);
    const shuttle = u.add({ kind: "amr", x: ax, z: r1z, yaw: 0, settings: { amrRole: "shuttle", emptyPallet: "forklift" } });
    const p = u.add({ kind: "pallet", x: ax, z: r1z, yaw: 0, settings: { capacity, mountedOn: u.id(shuttle) } });
    u.links.push({ type: "feed", from: belt, to: shuttle }, { type: "deliver", from: p, to: line.unload });
    // Empty-pallet stack + service forklift on the west aisle, downstream of the unload dock (clear of the shuttle path).
    const sz = round(line.unloadZ + 2 * lane + 2);
    u.add({ kind: "dock", x: round(D - lane2), z: sz, yaw: Math.PI / 2, settings: { dockRole: "palletSource" } });
    u.add({ kind: "amr", x: round(D - lane2), z: round(sz + 5), yaw: Math.PI / 2, settings: { amrRole: "forklift", forkliftTask: "service" } });
    return { west: ax - AMR_TRAFFIC.loadedRadius - 1 };
  }

  /**
   * Palletize + AMR transfer to the outbound conveyor (east of belt B's end): robots east of B (facing it) stack onto
   * floor pallets; the line forklift puts each full pallet onto the AMR's roller deck (AMRs never lift a floor pallet)
   * and the AMR rolls it onto the outbound conveyor, which runs back south along the east aisle (start at its north end).
   */
  function amrToConveyor(u, { D = 0, cells, line, capacity = 2 }) {
    const pallets = [];
    for (let k = 0; k < cells; k++) {
      const z = cellZ(k), rx = round(D + R.beltToRobot);
      u.add({ kind: "robot", x: rx, z, yaw: face(rx, z, D, z) });
      pallets.push(u.add({ kind: "pallet", x: round(D + R.beltToRobot + R.robotToPallet), z, yaw: 0, settings: { capacity } }));
    }
    const amr = u.add({ kind: "amr", x: round(D + lane2), z: round(SCAN_TUNNEL.exitDistance - 2), yaw: 0 });
    u.add({ kind: "amr", x: round(D + lane1), z: round(SCAN_TUNNEL.exitDistance - 5), yaw: 0, settings: { amrRole: "forklift" } });
    const ox = round(D + aisleEdge + BELT.width / 2 + 0.3), oStart = round(line.bEnd + 1);
    const outbound = u.add({ kind: "conveyor", x: ox, z: round(oStart - BELT.length / 2), yaw: Math.PI, settings: { conveyorRole: "outbound" } });
    for (const p of pallets) u.links.push({ type: "pickup", from: amr, to: p }, { type: "deliver", from: p, to: outbound });
    return { east: ox + BELT.width / 2 + 1, north: oStart + lane + 0.5 };
  }

  /** Concatenate units (re-indexing links, resolving `@i` mounts) and centre the fixed template floor on them. */
  function compose(units) {
    const equipment = [], links = [];
    for (const u of units) {
      const base = equipment.length;
      equipment.push(...u.eq);
      links.push(...u.links.map((l) => ({ ...l, from: l.from + base, to: l.to + base })));
      for (let i = base; i < equipment.length; i++) {
        const m = equipment[i].settings?.mountedOn;
        if (typeof m === "string" && m.startsWith("@")) {
          const j = base + Number(m.slice(1));
          equipment[i] = { ...equipment[i], settings: { ...equipment[i].settings, mountedOn: `${equipment[j].kind}-${j + 1}` } };
        }
      }
    }
    const b = units.map((u) => u.bounds);
    const minX = Math.min(...b.map((v) => v.minX)), maxX = Math.max(...b.map((v) => v.maxX));
    const minZ = Math.min(...b.map((v) => v.minZ)), maxZ = Math.max(...b.map((v) => v.maxZ));
    const { width, depth } = FACTORY_ROOM.templateFloor;
    if (maxX - minX > width || maxZ - minZ > depth) throw new Error(`layout ${round(maxX - minX)}x${round(maxZ - minZ)} exceeds the ${width}x${depth} floor`);
    equipment.push({ kind: "floor", x: round((minX + maxX) / 2), z: round((minZ + maxZ) / 2), yaw: 0, floor: { width, depth, wallHeight: FACTORY_ROOM.defaultWallHeight } });
    return { equipment, links };
  }

  /** (a) Box line -> scan -> palletize -> forklift loads the AMR -> AMR hands the pallet to the outbound conveyor. */
  function amrTransferTemplate({ cells = 2 } = {}) {
    const u = unit();
    const line = scanLine(u, { cells, fed: false });
    const out = amrToConveyor(u, { cells, line });
    u.bounds = { minX: -SCAN_TUNNEL.width / 2 - 1, maxX: out.east, minZ: line.aStart - 0.5, maxZ: out.north };
    return compose([u]);
  }
  /** (b) Pallet infeed -> AMR docks beside the scanner-side belt -> R2 depalletizes onto it -> scan tunnel. */
  function scannerInfeedTemplate({ cells = 1 } = {}) {
    const u = unit();
    const line = scanLine(u, { cells });
    const inf = palletInfeed(u, { line });
    u.bounds = { minX: inf.west, maxX: aisleEdge + 0.5, minZ: line.aStart - 0.5, maxZ: line.bEnd + 2 };
    return compose([u]);
  }
  /** (c) Whole line: pallet infeed -> depalletize -> scan -> palletize -> AMR -> outbound conveyor. */
  function fullFactoryTemplate({ cells = 2 } = {}) {
    const u = unit();
    const line = scanLine(u, { cells });
    const inf = palletInfeed(u, { line });
    const out = amrToConveyor(u, { cells, line });
    u.bounds = { minX: inf.west, maxX: out.east, minZ: line.aStart - 0.5, maxZ: out.north };
    return compose([u]);
  }

  const templates = [
    { id: "amr-conveyor-transfer", name: "AMR → 컨베이어 이송", description: "박스 라인에서 스캔한 박스를 로봇이 팔레트에 적재하고, 지게차가 완성 팔레트를 AMR에 올리면 AMR이 롤러로 출고 컨베이어에 넘깁니다.",
      ...amrTransferTemplate() },
    { id: "scanner-infeed", name: "스캐너 투입 (AMR 도킹 → 로봇 하역)", description: "입고 컨베이어가 적재 팔레트를 롤러 AMR에 넘기고, AMR이 스캐너 쪽 컨베이어 옆 도크에 붙으면 로봇이 AMR 위 박스를 하나씩 스캐너 컨베이어에 올립니다. 빈 팔레트는 지게차가 빈 팔레트 적치장으로 옮깁니다.",
      ...scannerInfeedTemplate() },
    { id: "full-factory", name: "전체 공장 (입고 → 스캔 → 적재 → 출고)", description: "팔레트 입고 → AMR 도킹·로봇 하역 → 스캔 → 로봇 적재 → 지게차가 AMR에 적재 → AMR이 출고 컨베이어로 이송까지 전 공정을 한 라인에 묶었습니다.",
      ...fullFactoryTemplate() },
  ];
  // 자동 생성: new conveyors default to off, so every flow source (a belt start with no feeding belt that is not
  // robot-fed / outbound) is switched on explicitly; all other belts are written off.
  for (const t of templates) {
    const objects = t.equipment.map((e, i) => ({ ...e, id: `${e.kind}-${i + 1}` }));
    const { incoming } = beltConnections(objects);
    objects.forEach((o, i) => {
      if (o.kind !== "conveyor") return;
      const role = o.settings?.conveyorRole;
      const source = !incoming.has(o.id) && role !== "fed" && role !== "outbound" && role !== "ship";
      t.equipment[i] = { ...t.equipment[i], settings: { ...t.equipment[i].settings, autoSpawn: source } };
    });
  }
  mkdirSync(outDir, { recursive: true });
  templates.forEach((t, i) => {
    const file = `${outDir}/${String(i + 1).padStart(2, "0")}-${t.id}.json`;
    writeFileSync(file, JSON.stringify({ id: t.id, name: t.name, description: t.description, equipment: t.equipment, links: t.links }, null, 2) + "\n", "utf8");
    const floor = t.equipment.find((e) => e.kind === "floor").floor;
    console.log(`${file}: ${t.equipment.length} equipment, ${t.links.length} links, floor ${floor.width}x${floor.depth}x${floor.wallHeight}`);
  });
  console.log(`lane ${round(lane)} lane1 ${round(lane1)} lane2 ${round(lane2)} aisleEdge ${round(aisleEdge)} aisle clear ${round(aisleEdge - palletEdge)}`);
} finally {
  await server.close();
}
