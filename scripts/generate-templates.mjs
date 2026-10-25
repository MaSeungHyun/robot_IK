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
  const { RACK_CONFIG } = await load("/src/constants/rack.ts");

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
  const [rackW, rackD] = RACK_CONFIG.footprint; // local x (loading depth) / z (length)
  /** Rack (yaw pi/2: length along world x, loading face -> -z) column pitch and row pitch (row gap fits AMR + forklift). */
  const rackPitchX = rackD + 0.15, rackPitchZ = rackW + 2 * lane;
  const rackFirst = aisleEdge + rackD / 2 + 0.1;

  /**
   * One SLP zone: a straight line (belt + tunnel, stopper at the last robot) with its own two-lane AMR aisle on the
   * pallet side (`side`), an AMR, drop docks at the aisle's downstream end and an optional rack block with forklift
   * beyond the aisle. Links make the zone self-contained: its AMR serves only its pallets, which go only to its docks/racks.
   */
  function zone({ x: X, z0 = 0, side = -1, cells, spawn = 5, defect = false, defectRate = 0, capacity, storage, overflowDock = true, amrs = 1 }) {
    const eq = [], links = [];
    const add = (e) => (eq.push(e), eq.length - 1);
    const out = (d) => round(X + side * d);
    const lastRobot = SCAN_TUNNEL.exitDistance + firstSlot + (cells - 1) * R.robotPitch;
    const beltEnd = z0 + lastRobot + BOX_SIZES[0].z / 2, beltStart = beltEnd - BELT.length;
    add({ kind: "conveyor", x: round(X), z: round(beltStart + BELT.length / 2), yaw: 0, settings: { spawnInterval: spawn } });
    add({ kind: "scanner", x: round(X), z: round(beltStart + SCAN_TUNNEL.startOffset), yaw: 0, settings: { defectRate } });
    const pallets = [];
    for (let k = 0; k < cells; k++) {
      const z = round(z0 + SCAN_TUNNEL.exitDistance + firstSlot + k * R.robotPitch), isDefect = defect && k === 0;
      add({ kind: "robot", x: out(R.beltToRobot), z, yaw: 0, ...(isDefect && { settings: { pickFilter: "defect" } }) });
      const settings = { ...(capacity && { capacity }), ...(isDefect && { grade: "defect" }) };
      pallets.push({ i: add({ kind: "pallet", x: out(R.beltToRobot + R.robotToPallet), z, yaw: 0, ...(Object.keys(settings).length && { settings }) }), defect: isDefect });
    }
    const agents = [];
    for (let a = 0; a < amrs; a++) agents.push(add({ kind: "amr", x: out(lane2), z: round(z0 + SCAN_TUNNEL.exitDistance - 2 - a * 3), yaw: 0 }));
    const dockZ = round(beltEnd + 3);
    const normalDocks = [], defectDocks = [];
    if (defect) defectDocks.push(add({ kind: "dock", x: out(lane2), z: dockZ, yaw: 0, settings: { acceptGrade: "defect" } }));
    if (!storage || overflowDock) normalDocks.push(add({ kind: "dock", x: out(lane1), z: storage ? round(dockZ + 2 * lane) : dockZ, yaw: 0, ...(defect && { settings: { acceptGrade: "normal" } }) }));
    const racks = [];
    let wall = aisleEdge + 0.5, forkliftIndex = -1, door = null;
    if (storage) {
      const rows = Array.from({ length: storage.rows }, (_, r) => round(z0 + SCAN_TUNNEL.exitDistance + rackW / 2 + r * rackPitchZ));
      for (let c = 0; c < storage.cols; c++)
        for (const z of rows) racks.push(add({ kind: "rack", x: out(rackFirst + c * rackPitchX), z, yaw: Math.PI / 2, settings: { acceptGrade: "normal" } }));
      const outer = rackFirst + (storage.cols - 1) * rackPitchX + rackD / 2;
      // Forklift lane between the outer rack edge and the wall, door in that wall (forklift exit for unloading).
      forkliftIndex = add({ kind: "amr", x: out(outer + lane / 2 + 0.3), z: round(rows[0] - rackPitchZ / 2), yaw: 0, settings: { amrRole: "forklift" } });
      wall = outer + lane + 1.2;
      door = { z: round((rows[0] + rows[rows.length - 1]) / 2) };
    }
    for (const a of agents) for (const p of pallets) links.push({ type: "pickup", from: a, to: p.i });
    for (const p of pallets) for (const d of p.defect ? defectDocks : [...normalDocks, ...racks]) links.push({ type: "deliver", from: p.i, to: d });
    const bounds = {
      zMin: beltStart - 1, zMax: Math.max(dockZ + 3 * lane, ...racks.map((r) => eq[r].z + rackW / 2 + 1)) + 0.5,
      out: X + side * wall, in: X - side * (SCAN_TUNNEL.width / 2 + 1),
    };
    return { eq, links, bounds, side, door, forkliftIndex };
  }

  /** Concatenate zones (re-indexing links), size the floor to fit and put each storage door in its wall. */
  function compose(zones, { wallMargin = 0 } = {}) {
    const equipment = [], links = [];
    for (const z of zones) {
      const base = equipment.length;
      equipment.push(...z.eq);
      links.push(...z.links.map((l) => ({ ...l, from: l.from + base, to: l.to + base })));
      // Zone-local mount references ("@i") -> scene ids of the composed list.
      for (let i = base; i < equipment.length; i++) {
        const m = equipment[i].settings?.mountedOn;
        if (typeof m === "string" && m.startsWith("@")) {
          const j = base + Number(m.slice(1));
          equipment[i] = { ...equipment[i], settings: { ...equipment[i].settings, mountedOn: `${equipment[j].kind}-${j + 1}` } };
        }
      }
    }
    const xs = zones.flatMap((z) => [z.bounds.out, z.bounds.in]);
    const minX = Math.floor(Math.min(...xs) - wallMargin), maxX = Math.ceil(Math.max(...xs) + wallMargin);
    const minZ = Math.floor(Math.min(...zones.map((z) => z.bounds.zMin))), maxZ = Math.ceil(Math.max(...zones.map((z) => z.bounds.zMax)));
    equipment.push({ kind: "floor", x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, yaw: 0, floor: { width: maxX - minX, depth: maxZ - minZ, wallHeight: FACTORY_ROOM.defaultWallHeight } });
    for (const z of zones) if (z.door) equipment.push({ kind: "door", x: z.side < 0 ? minX : maxX, z: z.door.z, yaw: z.side < 0 ? Math.PI / 2 : -Math.PI / 2 });
    return { equipment, links };
  }
  /** Back-to-back pair spacing: belt centres far enough apart for both tunnels. */
  const pairGap = round(SCAN_TUNNEL.width + 0.4);
  /** Next pair: previous outer aisle edge + this pair's aisle (aisles abut, never shared). */
  const pairPitch = round(pairGap + 2 * aisleEdge);

  /**
   * Inbound -> depalletize -> scan -> palletize -> outbound conveyor (AMR top-roller transfer).
   * West: inbound belt, its end robot stacks onto pallet P1; AMR 1 (west aisle) brings P1 to the unload dock.
   * Main line (x = D): the depalletizing robot puts the boxes one by one on the fed belt A, which chains into belt B
   * (scan tunnel at its start); B's end robots palletize; AMR 2 (east aisle) hands full pallets to the outbound belt.
   */
  function inboundOutbound({ cells = 2, capacity = 2, spawn = 6 } = {}) {
    const eq = [], links = [];
    const add = (e) => (eq.push(e), eq.length - 1);
    const D = 0;
    const lastRobot = SCAN_TUNNEL.exitDistance + firstSlot + (cells - 1) * R.robotPitch;
    const bEnd = lastRobot + BOX_SIZES[0].z / 2, bStart = bEnd - BELT.length, aStart = bStart - BELT.length;
    add({ kind: "conveyor", x: D, z: round(aStart + BELT.length / 2), yaw: 0, settings: { conveyorRole: "fed" } });
    add({ kind: "conveyor", x: D, z: round(bStart + BELT.length / 2), yaw: 0 });
    add({ kind: "scanner", x: D, z: round(bStart + SCAN_TUNNEL.startOffset), yaw: 0 });
    const unloadZ = round(bStart - 4);
    add({ kind: "robot", x: round(D - R.beltToRobot), z: unloadZ, yaw: 0, settings: { robotRole: "depalletize" } });
    const unload = add({ kind: "dock", x: round(D - R.beltToRobot - R.robotToPallet), z: unloadZ, yaw: 0, settings: { dockRole: "unload" } });
    // West inbound zone, mirrored across the west aisle.
    const p1x = D - aisleEdge - STREAM_CONFIG.palletWidth / 2 - 0.1, r1x = p1x - R.robotToPallet, ix = r1x - R.beltToRobot;
    const iEnd = unloadZ + 2, r1z = round(iEnd - BOX_SIZES[0].z / 2);
    add({ kind: "conveyor", x: round(ix), z: round(iEnd - BELT.length / 2), yaw: 0, settings: { conveyorRole: "inbound", spawnInterval: spawn } });
    add({ kind: "robot", x: round(r1x), z: r1z, yaw: 0 });
    const p1 = add({ kind: "pallet", x: round(p1x), z: r1z, yaw: 0, settings: { capacity } });
    const amr1 = add({ kind: "amr", x: round(D - lane2), z: round(unloadZ - 8), yaw: 0 });
    links.push({ type: "pickup", from: amr1, to: p1 }, { type: "deliver", from: p1, to: unload });
    // Palletizing robots at B's end (east side) and the outbound conveyor at the east aisle's downstream end.
    const pallets = [];
    for (let k = 0; k < cells; k++) {
      const z = round(SCAN_TUNNEL.exitDistance + firstSlot + k * R.robotPitch);
      add({ kind: "robot", x: round(D + R.beltToRobot), z, yaw: 0 });
      pallets.push(add({ kind: "pallet", x: round(D + R.beltToRobot + R.robotToPallet), z, yaw: 0, settings: { capacity } }));
    }
    const amr2 = add({ kind: "amr", x: round(D + lane2), z: round(SCAN_TUNNEL.exitDistance - 2), yaw: 0 });
    const oStart = bEnd + 3 + STREAM_CONFIG.palletDepth;
    const outbound = add({ kind: "conveyor", x: round(D + lane1), z: round(oStart + BELT.length / 2), yaw: 0, settings: { conveyorRole: "outbound" } });
    for (const p of pallets) links.push({ type: "pickup", from: amr2, to: p }, { type: "deliver", from: p, to: outbound });
    const bounds = { zMin: aStart - 1, zMax: oStart + BELT.length + 1, out: D + aisleEdge + 0.5, in: ix - SCAN_TUNNEL.width / 2 - 1 };
    return { eq, links, bounds, side: 1, door: null, forkliftIndex: -1 };
  }

  /**
   * Pallet cycle (domain/cycle/PalletCycle): shuttle AMRs carry their pallet on the deck.
   * 1. 입하: inbound belt end robot R1 stacks onto the pallet on shuttle A (west); full -> unload dock beside R2.
   * 2. 스캔: R2 puts the boxes one by one on fed belt A -> scan tunnel on belt B; the empty pallet rides back on A.
   * 3. R3 (belt B end) stacks onto shuttle B; full -> service dock (east aisle, downstream). The service forklift puts
   *    the full pallet into a Rack_m level and a new empty pallet (pallet source stack) back onto shuttle B.
   * 4. A full Rack_m is carried by the AGV to the rack drop point; the rack forklift stores its pallets in the Racks and
   *    takes the oldest ones to the stage dock east of the rack row, where R4 puts the boxes on the ship belt (출하).
   * Pallet-unit inbound (inboundUnit "pallet"): the inbound belt feeds whole pallets onto shuttle A (no R1).
   * Approach rules: forklifts reach a Rack_m from its local +X face (east, yaw 0), the AGV drives under it from local -Z
   * (south); the two bays sit in a row on the same z, bay2 6.5 m west so its forklift stand clears bay1's AGV lane.
   * Fixed racks (yaw pi/2) load from the south. Service/source docks use yaw -pi/2; the stage dock (yaw pi/2)
   * is served from the west (rack side), so the rack forklift never crosses the drop point.
   */
  function palletCycle({ x0 = 0, cells = 1, inbounds = 1, relay = false, capacity = 4, spawn = 6, inboundUnit = "box", palletSpawn = 60, robotSpeed } = {}) {
    const eq = [], links = [];
    const fast = robotSpeed ? { speed: robotSpeed } : {};
    const add = (e) => (eq.push(e), eq.length - 1);
    const id = (i) => `@${i}`;
    const D = x0;
    const lastRobot = SCAN_TUNNEL.exitDistance + firstSlot + (cells - 1) * R.robotPitch;
    const bEnd = lastRobot + BOX_SIZES[0].z / 2, bStart = bEnd - BELT.length, aStart = bStart - BELT.length;
    add({ kind: "conveyor", x: D, z: round(aStart + BELT.length / 2), yaw: 0, settings: { conveyorRole: "fed" } });
    add({ kind: "conveyor", x: D, z: round(bStart + BELT.length / 2), yaw: 0 });
    add({ kind: "scanner", x: D, z: round(bStart + SCAN_TUNNEL.startOffset), yaw: 0 });
    const unloadZ = round(bStart - 4);
    add({ kind: "robot", x: round(D - R.beltToRobot), z: unloadZ, yaw: 0, settings: { robotRole: "depalletize", ...fast } });
    const unload = add({ kind: "dock", x: round(D - R.beltToRobot - R.robotToPallet), z: unloadZ, yaw: 0, settings: { dockRole: "unload" } });
    // 1. West inbound zone (as the inbound/outbound template), the pallet station is shuttle A's home.
    const p1x = D - aisleEdge - STREAM_CONFIG.palletWidth / 2 - 0.1, r1x = p1x - R.robotToPallet, ix = r1x - R.beltToRobot;
    const iEnd = unloadZ + 2, r1z = round(iEnd - BOX_SIZES[0].z / 2);
    if (inboundUnit === "pallet") {
      // Pallet-unit inbound: the belt runs straight into the roller-top shuttle (same surface height), no R1.
      add({ kind: "conveyor", x: round(p1x), z: round(r1z - ROLLER_GAP - BELT.length / 2), yaw: 0, settings: { conveyorRole: "inbound", inboundUnit: "pallet", spawnInterval: palletSpawn } });
    } else {
      add({ kind: "conveyor", x: round(ix), z: round(iEnd - BELT.length / 2), yaw: 0, settings: { conveyorRole: "inbound", inboundUnit: "box", spawnInterval: spawn } });
      add({ kind: "robot", x: round(r1x), z: r1z, yaw: 0, ...(robotSpeed ? { settings: fast } : {}) });
    }
    const shuttleA = add({ kind: "amr", x: round(p1x), z: r1z, yaw: 0, settings: { amrRole: "shuttle" } });
    const p1 = add({ kind: "pallet", x: round(p1x), z: r1z, yaw: 0, settings: { capacity, mountedOn: id(shuttleA) } });
    links.push({ type: "deliver", from: p1, to: unload });
    // Relay shuttle: a second shuttle home north of an inbound robot (also in its reach). The robot fills the nearest
    // pallet first, then the other, so one pallet is always at the station while the full one is away.
    const relayShuttle = (rx, dock) => {
      if (!relay) return;
      const z = round(r1z + R.robotToPallet);
      const s = add({ kind: "amr", x: round(rx), z, yaw: 0, settings: { amrRole: "shuttle" } });
      const p = add({ kind: "pallet", x: round(rx), z, yaw: 0, settings: { capacity, mountedOn: id(s) } });
      links.push({ type: "deliver", from: p, to: dock });
    };
    if (inboundUnit !== "pallet") relayShuttle(r1x, unload);
    // 1b. Second (box) inbound station west of the first belt: while one shuttle travels / unloads, the other loads.
    // Its shuttle leaves north past the first belt's end, then east to the shared unload dock.
    let west = ix;
    for (let k = 1; k < inbounds; k++) {
      const px = west - SCAN_TUNNEL.width / 2 - AMR_TRAFFIC.loadedRadius - AMR_TRAFFIC.safetyMargin, rx = px - R.robotToPallet;
      west = rx - R.beltToRobot;
      add({ kind: "conveyor", x: round(west), z: round(iEnd - BELT.length / 2), yaw: 0, settings: { conveyorRole: "inbound", inboundUnit: "box", spawnInterval: spawn } });
      add({ kind: "robot", x: round(rx), z: r1z, yaw: 0, ...(robotSpeed ? { settings: fast } : {}) });
      const shuttle = add({ kind: "amr", x: round(px), z: r1z, yaw: 0, settings: { amrRole: "shuttle" } });
      const p = add({ kind: "pallet", x: round(px), z: r1z, yaw: 0, settings: { capacity, mountedOn: id(shuttle) } });
      // Own depalletizing dock + robot further upstream on belt A, so both shuttles unload in parallel.
      const uz = round(unloadZ - k * 4);
      add({ kind: "robot", x: round(D - R.beltToRobot), z: uz, yaw: 0, settings: { robotRole: "depalletize", ...fast } });
      const dock = add({ kind: "dock", x: round(D - R.beltToRobot - R.robotToPallet), z: uz, yaw: 0, settings: { dockRole: "unload" } });
      links.push({ type: "deliver", from: p, to: dock });
      relayShuttle(rx, dock);
    }
    // 3. Belt B end robots R3 (one per cell) and their shuttles B (east), full pallets to the service dock.
    const pBx = round(D + R.beltToRobot + R.robotToPallet), sx = round(D + lane1), sz = round(bEnd + 3);
    const loaded = [];
    for (let k = 0; k < cells; k++) {
      const r3z = round(lastRobot - (cells - 1 - k) * R.robotPitch);
      add({ kind: "robot", x: round(D + R.beltToRobot), z: r3z, yaw: 0 });
      const shuttleB = add({ kind: "amr", x: pBx, z: r3z, yaw: 0, settings: { amrRole: "shuttle" } });
      loaded.push(add({ kind: "pallet", x: pBx, z: r3z, yaw: 0, settings: { capacity, mountedOn: id(shuttleB) } }));
    }
    const service = add({ kind: "dock", x: sx, z: sz, yaw: -Math.PI / 2, settings: { dockRole: "service" } });
    for (const p2 of loaded) links.push({ type: "deliver", from: p2, to: service });
    add({ kind: "amr", x: round(sx + 5), z: sz, yaw: -Math.PI / 2, settings: { amrRole: "forklift", forkliftTask: "service" } });
    add({ kind: "dock", x: sx, z: round(sz + 3), yaw: -Math.PI / 2, settings: { dockRole: "palletSource" } });
    // Rack_m bays in a row (forklift stand east of each, AGV lane south -> north along each bay's x);
    // bay2 sits far enough west that its forklift stand stays clear of bay1's AGV lane (diagonal bays deadlocked).
    const bay1 = { x: sx, z: round(sz + 7.5) }, bay2 = { x: round(sx - 6.5), z: round(sz + 7.5) };
    add({ kind: "rack", x: bay1.x, z: bay1.z, yaw: 0, settings: { rackType: "mobile" } });
    add({ kind: "rack", x: bay2.x, z: bay2.z, yaw: 0, settings: { rackType: "mobile" } });
    add({ kind: "amr", x: round(sx - 9.5), z: round(sz + 4.5), yaw: 0, settings: { amrRole: "agv" } });
    // 4. Rack zone: drop point, fixed racks (south face), rack forklift, stage dock + R4 + ship belt (west).
    const dz = round(sz + 16);
    add({ kind: "dock", x: sx, z: dz, yaw: 0, settings: { dockRole: "rackDrop" } });
    const rackZ = round(dz + 4.5);
    for (let c = 0; c < 2; c++) add({ kind: "rack", x: round(sx + 4 + c * rackPitchX), z: rackZ, yaw: Math.PI / 2 });
    add({ kind: "amr", x: round(sx + 4), z: round(dz - 2.5), yaw: 0, settings: { amrRole: "forklift", forkliftTask: "rack" } });
    // Stage east of the rack row (forklift from the west, rack side): its route never crosses the drop point,
    // where the AGV waits under a Rack_m for the rack forklift (west stage deadlocked in flow-check).
    const stx = round(sx + 4 + rackPitchX + 6), stz = dz;
    add({ kind: "dock", x: stx, z: stz, yaw: Math.PI / 2, settings: { dockRole: "stage" } });
    const r4x = round(stx + R.robotToPallet);
    add({ kind: "robot", x: r4x, z: stz, yaw: 0, settings: { robotRole: "depalletize" } });
    const shipX = round(r4x + R.beltToRobot);
    add({ kind: "conveyor", x: shipX, z: round(stz - 1 + BELT.length / 2), yaw: 0, settings: { conveyorRole: "ship" } });
    const bounds = { zMin: aStart - 1, zMax: Math.max(rackZ + rackW / 2 + 1.5, stz - 1 + BELT.length + 1), out: shipX + SCAN_TUNNEL.width / 2 + 1, in: west - SCAN_TUNNEL.width / 2 - 1 };
    return { eq, links, bounds, side: 1, door: null, forkliftIndex: -1 };
  }

  /** Several pallet-cycle cells side by side (translated along x), each running as its own cycle cell. */
  function multiCycle({ lines, gap = 2, pitch: fixed, ...opts }) {
    const probe = palletCycle(opts).bounds, pitch = fixed ?? Math.ceil(probe.out - probe.in + gap);
    return Array.from({ length: lines }, (_, k) => palletCycle({ ...opts, x0: k * pitch }));
  }
  const templates = [
    { id: "palletizing", name: "기본 팔레타이징", description: "컨베이어의 박스를 로봇이 집어 팔레트에 적재하고, AMR이 완료 팔레트를 라인 끝 도크로 출고합니다.",
      ...compose([zone({ x: 0, cells: 1 })]) },
    { id: "robot-amr", name: "듀얼 로봇 + AMR", description: "두 로봇이 적재하고 AMR이 2차선 통로로 완료된 팔레트를 출고합니다.",
      ...compose([zone({ x: 0, cells: 2 })]) },
    { id: "inspection-line", name: "컨베이어 검사 라인", description: "독립된 3개 검사 라인. 라인마다 전용 AMR 통로와 정상/불량 도크가 있고, 첫 라인은 랙 보관을 함께 씁니다.",
      ...compose([
        zone({ x: 0, side: -1, cells: 4, defect: true, defectRate: 0.3, capacity: 3, storage: { cols: 2, rows: 3 } }),
        zone({ x: pairGap, side: 1, cells: 4, defect: true, defectRate: 0.3, capacity: 3 }),
        zone({ x: pairPitch, side: -1, cells: 4, defect: true, defectRate: 0.3, capacity: 3 }),
      ]) },
    { id: "suitable-design-01", name: "적합 설계 01", description: "SLP 기반 추천 설계: 등을 맞댄 2쌍 4라인, 라인별 전용 2차선 AMR 통로와 도크, 외곽 랙 보관.",
      ...compose([
        zone({ x: 0, side: -1, cells: 2, spawn: 7.438, storage: { cols: 2, rows: 3 } }),
        zone({ x: pairGap, side: 1, cells: 2, spawn: 7.438 }),
        zone({ x: pairPitch, side: -1, cells: 2, spawn: 7.438 }),
        zone({ x: pairPitch + pairGap, side: 1, cells: 2, spawn: 7.438 }),
      ]) },
    { id: "compact-forklift-storage", name: "소형 단일 라인 + 지게차 보관", description: "한 라인의 로봇 3대가 적재하고, AMR이 랙 앞 인계 지점까지 옮긴 팔레트를 지게차가 랙에 보관합니다(랙이 바쁘면 도크로 출고).",
      ...compose([zone({ x: 0, cells: 3, storage: { cols: 2, rows: 3 } })]) },
    { id: "two-line-ship-store", name: "2라인 검사 적재 + 출고/보관", description: "등을 맞댄 두 라인에서 스캔 후 적재하고, 라인별 AMR이 자기 쪽 랙에 보관하거나 도크로 출고합니다.",
      ...compose([
        zone({ x: 0, side: -1, cells: 3, spawn: 4, storage: { cols: 1, rows: 3 } }),
        zone({ x: pairGap, side: 1, cells: 3, spawn: 4, storage: { cols: 1, rows: 3 } }),
      ]) },
    { id: "four-line-high-throughput", name: "4라인 고처리량 + 랙", description: "네 라인(라인당 로봇 3대)이 라인별 전용 AMR 통로·도크를 쓰고, 서쪽 외곽 라인은 지게차 랙 보관을 함께 씁니다(지게차가 다른 라인 통로를 가로지르지 않도록 보관 구역은 한 곳).",
      ...compose([
        zone({ x: 0, side: -1, cells: 3, storage: { cols: 2, rows: 3 } }),
        zone({ x: pairGap, side: 1, cells: 3 }),
        zone({ x: pairPitch, side: -1, cells: 3 }),
        zone({ x: pairPitch + pairGap, side: 1, cells: 3 }),
      ]) },
    { id: "inbound-scan-store", name: "입고 검사 · 적재 · 랙 보관 흐름", description: "입고 박스를 스캔해 불량은 별도 팔레트·도크로 분리하고, 정상품은 적재 후 지게차가 랙에 보관합니다.",
      ...compose([zone({ x: 0, cells: 4, defect: true, defectRate: 0.2, capacity: 3, amrs: 2, storage: { cols: 2, rows: 3 } })]) },
    { id: "inbound-depal-scan-outbound", name: "입하 · 하역 · 검사 · 출하 컨베이어", description: "입하 컨베이어 끝 로봇이 AMR용 팔레트에 쌓고, AMR이 하역 구역으로 옮기면 로봇이 박스를 하나씩 스캐너 라인에 올립니다. 스캔 후 라인 끝 로봇이 다시 적재하고, AMR 상부 롤러로 출하 컨베이어에 넘깁니다.",
      ...compose([inboundOutbound()]) },
    { id: "pallet-cycle-rack-m", name: "팔레트 순환 · Rack_m · AGV · 출하", description: "AMR 위 팔레트에 입하 박스를 쌓아 스캐너 하역 구역으로 옮기고, 스캔 후 다시 AMR 팔레트에 쌓습니다. 지게차가 다 찬 팔레트를 Rack_m에 옮기고 빈 팔레트를 올려 주며, 다 찬 Rack_m은 AGV가 랙 구역으로 운반합니다. 랙 지게차가 랙에 보관하고 출하할 팔레트를 출하 로봇 옆에 두면 로봇이 박스를 출하 컨베이어에 하나씩 올립니다.",
      ...compose([palletCycle()]) },
    { id: "pallet-cycle-pallet-inbound", name: "팔레트 순환 · 팔레트 단위 입하 (롤러 AMR)", description: "입하 컨베이어가 박스 대신 적재된 팔레트를 내보내고, 컨베이어와 같은 높이의 롤러 상단 AMR로 팔레트가 바로 이송됩니다. 이후 스캐너 하역 → 재적재 → Rack_m → AGV → 랙 → 출하 흐름은 동일합니다.",
      ...compose([palletCycle({ inboundUnit: "pallet" })]) },
    { id: "pallet-cycle-multi-line", name: "팔레트 순환 · 4라인 고처리량", description: "순환 라인 4개를 30m 간격으로 촘촘히 배치했습니다. 라인마다 입하 컨베이어 2개·입하 로봇 2대·입하 셔틀 AMR 2대가 각자의 하역 도크(하역 로봇 2대, 속도 3×)로 병렬 운반해 흐름이 끊기지 않고, 재적재 로봇·셔틀 2대, 서비스·랙 지게차, AGV, Rack_m 2대, 랙 2개, 출하 컨베이어가 독립된 셀로 동작합니다.",
      ...compose(multiCycle({ lines: 4, cells: 2, inbounds: 2, relay: false, spawn: 20, robotSpeed: 3, pitch: 30 })) },
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
  console.log(`lane ${round(lane)} lane1 ${round(lane1)} lane2 ${round(lane2)} aisleEdge ${round(aisleEdge)} aisle clear ${round(aisleEdge - palletEdge)} pairGap ${pairGap} pairPitch ${pairPitch}`);
} finally {
  await server.close();
}
