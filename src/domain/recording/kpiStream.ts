/**
 * KPI stream: plant KPIs computed from the running FactorySimulator (sampled by the recorder at 1 Hz from sim t=0,
 * warm-up included, so every count is a day total). See docs/sim-recording.md "KPI stream" and KPI_SCHEMA.
 */
import type { FactorySimulator } from "@/domain/simulation/FactorySimulator";

/** Flow order. Box stages count boxes, pallet stages count pallets. */
export const KPI_STAGES = [
  { id: "inbound", unit: "boxes", count: "boxes arrived (spawned on inbound pallets / infeed)", wip: "arrived boxes not yet depalletized", progressOf: "inbound boxes (always 100 once any arrived)" },
  { id: "depalletize", unit: "boxes", count: "boxes taken off inbound pallets onto the line", wip: "depalletized boxes not yet scanned (no scanners: not yet palletized/passed)", progressOf: "inbound boxes" },
  { id: "scan", unit: "boxes", count: "boxes with a scan result (first scan per box)", wip: "scanned boxes not yet palletized or passed (0 without scanners)", progressOf: "inbound boxes" },
  { id: "palletize", unit: "boxes", count: "boxes placed on output pallets by robots", wip: "boxes on pallets still loading at stations", progressOf: "inbound boxes" },
  { id: "rackStore", unit: "pallets", count: "full pallets stored into racks", wip: "full pallets not yet stored (waiting / being carried)", progressOf: "full pallets" },
  { id: "outbound", unit: "pallets", count: "outbound (shipping) orders drawn from stored pallets", wip: "drawn orders not yet shipped", progressOf: "full pallets" },
  { id: "ship", unit: "pallets", count: "pallets shipped out through the stage door", wip: "always 0 (sink)", progressOf: "full pallets" },
] as const;
export type KpiStage = (typeof KPI_STAGES)[number]["id"];

type Key = { key: string; unit: string; type: "int" | "number" | "string" | "number|null"; meaning: string };
const K = (key: string, unit: string, type: Key["type"], meaning: string): Key => ({ key, unit, type, meaning });
/** Every key of a KPI sample. `<x>` segments are map keys (ids / stage names) listed in `placeholders`. */
export const KPI_SCHEMA = {
  version: 1,
  sampleHz: 1,
  encoding: "chunk tracks.kpi = rows [t, kpi] (t absolute sim s, one row per second, full object each row); snapshot.kpi = kpi at chunk start. Counts are day totals since sim t=0 (warm-up included).",
  placeholders: {
    "<stage>": KPI_STAGES.map((s) => s.id).join("|"),
    "<scannerId>": "manifest.equipment id of kind scanner",
    "<deviceId>": "robot, vehicle (AMR / forklift / cycle vehicle) or scanner id",
    "<vehicleId>": "vehicle id (equipment[] rows of the sim's agents)",
    "<robotId>": "robot arm id",
  },
  stages: KPI_STAGES,
  keys: [
    K("t", "s", "number", "sim time of the sample (absolute)"),
    K("throughput.processed", "boxes", "int", "processed today = boxes palletized (stages.palletize.count)"),
    K("throughput.perHour", "boxes/h", "number", "processed in the last 3600 s (scaled up while t < 3600)"),
    K("throughput.perMinute", "boxes/min", "number", "processed in the last 60 s"),
    K("throughput.avgPerHour", "boxes/h", "number", "processed / day elapsed"),
    K("stages.<stage>.count", "boxes|pallets (KPI_STAGES unit)", "int", "day total through the stage"),
    K("stages.<stage>.wip", "boxes|pallets (KPI_STAGES unit)", "int", "units queued at / inside the stage (KPI_STAGES wip)"),
    K("stages.<stage>.progress", "%", "number", "count / reference (KPI_STAGES progressOf) * 100"),
    K("wip.boxes", "boxes", "int", "boxes in process = inbound - palletized - passed (not yet on a pallet)"),
    K("wip.pallets", "pallets", "int", "full pallets not yet stored + open outbound orders"),
    K("pallets.full", "pallets", "int", "output pallets completed (filled) today"),
    K("boxes.passed", "boxes", "int", "boxes that ran off the line end unpicked"),
    K("scan.scanned", "boxes", "int", "boxes scanned (one result per box)"),
    K("scan.pass", "boxes", "int", "scan result normal"),
    K("scan.defect", "boxes", "int", "scan result defect"),
    K("scan.passRate", "%", "number|null", "pass / scanned * 100 (null before the first scan)"),
    K("scan.defectRate", "%", "number|null", "defect / scanned * 100 (null before the first scan)"),
    K("scan.scanners", "count", "int", "registered scanners (0 = scan KPIs not available)"),
    K("scan.byScanner.<scannerId>.scanned", "boxes", "int", "boxes this scanner scanned"),
    K("scan.byScanner.<scannerId>.pass", "boxes", "int", "normal results of this scanner"),
    K("scan.byScanner.<scannerId>.defect", "boxes", "int", "defect results of this scanner"),
    K("scan.byScanner.<scannerId>.passRate", "%", "number|null", "pass / scanned * 100"),
    K("scan.byScanner.<scannerId>.defectRate", "%", "number|null", "defect / scanned * 100"),
    K("rack.stored", "slots", "int", "rack slots holding a pallet"),
    K("rack.reserved", "slots", "int", "rack slots booked by a delivery in progress"),
    K("rack.slots", "slots", "int", "rack slots total"),
    K("rack.occupancy", "%", "number", "stored / slots * 100"),
    K("vehicles.total", "count", "int", "vehicles"),
    K("vehicles.busy", "count", "int", "vehicles busy now (not idle / waiting / charging / disabled)"),
    K("vehicles.utilization", "%", "number", "fleet mean of vehicles.byId.<vehicleId>.utilization"),
    K("vehicles.byId.<vehicleId>.utilization", "%", "number", "busy seconds / day elapsed * 100"),
    K("vehicles.byId.<vehicleId>.state", "enum", "string", "sim state (idle|waiting|charging|disabled|pickup|dispatch|loading|...)"),
    K("devices.<deviceId>.kind", "enum", "string", "robot|vehicle|scanner"),
    K("devices.<deviceId>.state", "enum", "string", "typed operation state (robots/vehicles: equipment operation; scanners: scanning (scan within 2 s) | idle)"),
    K("devices.<deviceId>.utilization", "%", "number|null", "robots: busy s / elapsed; vehicles: as vehicles.byId; scanners: null"),
    K("robots.<robotId>.cycles", "count", "int", "completed robot cycles (boxes moved)"),
    K("robots.<robotId>.cycleTimeLast", "s", "number|null", "time between the last two completed cycles"),
    K("robots.<robotId>.cycleTimeAvg", "s", "number|null", "mean of the last 10 cycle intervals"),
    K("robots.<robotId>.busyPerCycle", "s", "number|null", "busy seconds / cycles (day)"),
    K("robots.<robotId>.utilization", "%", "number", "busy seconds / day elapsed * 100"),
  ] as Key[],
};

type Num = number | null;
export type KpiSample = {
  t: number;
  throughput: { processed: number; perHour: number; perMinute: number; avgPerHour: number };
  stages: Record<KpiStage, { count: number; wip: number; progress: number }>;
  wip: { boxes: number; pallets: number };
  pallets: { full: number };
  boxes: { passed: number };
  scan: { scanned: number; pass: number; defect: number; passRate: Num; defectRate: Num; scanners: number; byScanner: Record<string, { scanned: number; pass: number; defect: number; passRate: Num; defectRate: Num }> };
  rack: { stored: number; reserved: number; slots: number; occupancy: number };
  vehicles: { total: number; busy: number; utilization: number; byId: Record<string, { utilization: number; state: string }> };
  devices: Record<string, { kind: "robot" | "vehicle" | "scanner"; state: string; utilization: Num }>;
  robots: Record<string, { cycles: number; cycleTimeLast: Num; cycleTimeAvg: Num; busyPerCycle: Num; utilization: number }>;
};

const r1 = (v: number) => Math.round(v * 10) / 10;
const pct = (n: number, d: number): Num => (d > 0 ? r1((n / d) * 100) : null);
const IDLE = new Set(["idle", "waiting", "charging", "disabled"]);

/** Call `sample(t)` at a steady rate from t=0 (utilization integrates busy time between calls). */
export class KpiTracker {
  private last = 0;
  private history: [number, number][] = [];
  private vehicleBusy = new Map<string, number>();
  private cycles = new Map<string, { count: number; at: number | null; intervals: number[] }>();
  private scanSeen = new Map<string, { scanned: number; at: number }>();
  private readonly world: FactorySimulator;
  constructor(world: FactorySimulator) {
    this.world = world;
  }

  sample(t: number): KpiSample {
    const w = this.world, eq = w.equipment, T = w.cargo.totals, c = w.cycle?.stats, dt = Math.max(0, t - this.last), elapsed = Math.max(t, 1e-9);
    this.last = t;
    const inbound = T.inbound, depal = w.depalletized, scanned = T.scanned, placed = w.placed, passed = w.passed, full = T.palletsFull;
    const stored = c?.storedToRack ?? w.forkliftStored, outbound = c?.outboundPallets ?? 0, shipped = c?.shippedPallets ?? 0;
    const scanners = eq.scanners ?? [], hasScan = scanners.length > 0;
    let onPallets = 0;
    for (const id of w.cargo.activeBoxes) if (w.cargo.box(id)?.state === "pallet") onPallets++;
    const box = (n: number) => pct(n, inbound) ?? 0, pal = (n: number) => pct(n, full) ?? 0;
    const stages: KpiSample["stages"] = {
      inbound: { count: inbound, wip: inbound - depal, progress: inbound > 0 ? 100 : 0 },
      depalletize: { count: depal, wip: hasScan ? depal - scanned : depal - placed - passed, progress: box(depal) },
      scan: { count: scanned, wip: hasScan ? scanned - placed - passed : 0, progress: box(scanned) },
      palletize: { count: placed, wip: onPallets, progress: box(placed) },
      rackStore: { count: stored, wip: full - stored, progress: pal(stored) },
      outbound: { count: outbound, wip: outbound - shipped, progress: pal(outbound) },
      ship: { count: shipped, wip: 0, progress: pal(shipped) },
    };
    // Throughput: processed = palletized boxes; rolling windows over the 1 Hz history.
    this.history.push([t, placed]);
    while (this.history.length > 1 && this.history[0][0] < t - 3600) this.history.shift();
    const at = (back: number) => { let v = this.history[0]; for (const h of this.history) { if (h[0] > t - back + 1e-6) break; v = h; } return v; };
    const [h0t, h0] = at(3600), [m0t, m0] = at(60);
    const perHour = t - h0t > 0 ? ((placed - h0) * 3600) / Math.max(t - h0t, Math.min(t, 3600)) : 0;
    const perMinute = t - m0t > 0 ? ((placed - m0) * 60) / Math.max(t - m0t, Math.min(t, 60)) : 0;
    // Scans per scanner (state: scanning within 2 s of its last scan).
    const byScanner: KpiSample["scan"]["byScanner"] = {}, devices: KpiSample["devices"] = {};
    for (const s of scanners) {
      const seen = this.scanSeen.get(s.id) ?? { scanned: 0, at: -Infinity };
      if (s.scanned !== seen.scanned) this.scanSeen.set(s.id, { scanned: s.scanned, at: t });
      const lastAt = this.scanSeen.get(s.id)?.at ?? -Infinity;
      byScanner[s.id] = { scanned: s.scanned, pass: s.scanned - s.faults, defect: s.faults, passRate: pct(s.scanned - s.faults, s.scanned), defectRate: pct(s.faults, s.scanned) };
      devices[s.id] = { kind: "scanner", state: t - lastAt <= 2 ? "scanning" : "idle", utilization: null };
    }
    // Robots: utilization from busy seconds, cycle time from count increments.
    const robots: KpiSample["robots"] = {};
    for (const [i, row] of eq.robots.entries()) {
      const r = w.robots[i], cy = this.cycles.get(row.id) ?? { count: 0, at: null, intervals: [] };
      if (row.count > cy.count) {
        if (cy.at !== null && cy.count > 0) { cy.intervals.push((t - cy.at) / (row.count - cy.count)); if (cy.intervals.length > 10) cy.intervals.shift(); }
        cy.count = row.count; cy.at = t;
      }
      this.cycles.set(row.id, cy);
      const util = r1(Math.min(100, ((r?.busySeconds ?? 0) / elapsed) * 100));
      robots[row.id] = { cycles: row.count, cycleTimeLast: cy.intervals.length ? r1(cy.intervals[cy.intervals.length - 1]) : null,
        cycleTimeAvg: cy.intervals.length ? r1(cy.intervals.reduce((a, b) => a + b, 0) / cy.intervals.length) : null,
        busyPerCycle: row.count > 0 ? r1((r?.busySeconds ?? 0) / row.count) : null, utilization: util };
      devices[row.id] = { kind: "robot", state: String(row.operation ?? row.state), utilization: util };
    }
    // Vehicles: busy time integrated between samples.
    const byId: KpiSample["vehicles"]["byId"] = {};
    let busyNow = 0, utilSum = 0;
    for (const a of eq.agents) {
      const busy = !IDLE.has(a.state);
      if (busy) { busyNow++; this.vehicleBusy.set(a.id, (this.vehicleBusy.get(a.id) ?? 0) + dt); }
      const util = r1(Math.min(100, ((this.vehicleBusy.get(a.id) ?? 0) / elapsed) * 100));
      byId[a.id] = { utilization: util, state: a.state }; utilSum += util;
      devices[a.id] = { kind: "vehicle", state: String(a.operation ?? a.state), utilization: util };
    }
    const racks = eq.racks ?? [], slots = racks.reduce((s, r) => s + r.slots.length, 0);
    const rs = racks.reduce((s, r) => s + r.slots.filter((x) => x.state === "stored").length, 0), rr = racks.reduce((s, r) => s + r.slots.filter((x) => x.state === "reserved").length, 0);
    return {
      t: Math.round(t * 100) / 100,
      throughput: { processed: placed, perHour: r1(perHour), perMinute: r1(perMinute), avgPerHour: r1((placed * 3600) / elapsed) },
      stages,
      wip: { boxes: inbound - placed - passed, pallets: full - stored + outbound - shipped },
      pallets: { full },
      boxes: { passed },
      scan: { scanned, pass: scanned - T.defects, defect: T.defects, passRate: pct(scanned - T.defects, scanned), defectRate: pct(T.defects, scanned), scanners: scanners.length, byScanner },
      rack: { stored: rs, reserved: rr, slots, occupancy: pct(rs, slots) ?? 0 },
      vehicles: { total: eq.agents.length, busy: busyNow, utilization: eq.agents.length ? r1(utilSum / eq.agents.length) : 0, byId },
      devices,
      robots,
    };
  }
}
