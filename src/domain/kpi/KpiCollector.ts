/**
 * KPI collection: pure domain (no three, no DOM). The simulator hands it one sample per sampling interval of
 * simulated time, so the report depends only on the fixed-step sequence and is identical at every playback speed.
 */
import type { EquipmentCategory, OperationState } from "@/domain/state/equipmentState";

export type KpiCounters = {
  /** Boxes spawned onto belts. */
  boxesIn: number;
  /** Boxes placed on pallets. */
  placed: number;
  /** Boxes that left a belt end without a pallet. */
  passed: number;
  /** Loaded pallets unloaded at docks (inbound). */
  palletsIn: number;
  /** Pallets dispatched/shipped. */
  palletsShipped: number;
  /** Boxes currently on belts (moving or reserved): work in progress. */
  wip: number;
};
export type KpiEquipmentSample = { id: string; name: string; category: EquipmentCategory; state: OperationState };
/** `phase` is the raw vehicle phase: "yielding"/"blocked" count as traffic waiting, "waiting" as dock/assignment waiting. */
export type KpiVehicleSample = { id: string; x: number; z: number; phase: string };
export type KpiSample = { counters: KpiCounters; equipment: KpiEquipmentSample[]; vehicles: KpiVehicleSample[] };
export type KpiConfig = { interval: number; cellSize: number };

export type KpiStateBucket = "busy" | "idle" | "waiting" | "blocked";
export type KpiEquipmentReport = {
  id: string; name: string; category: EquipmentCategory;
  /** Seconds per bucket (disabled time excluded). */
  seconds: Record<KpiStateBucket, number>;
  /** busy / (busy + idle + waiting + blocked), 0-1. */
  utilization: number;
};
export type KpiReport = {
  elapsed: number;
  samples: number;
  interval: number;
  counters: KpiCounters;
  perHour: { boxesIn: number; placed: number; palletsIn: number; palletsShipped: number };
  equipment: KpiEquipmentReport[];
  bottleneck: { id: string; name: string; utilization: number; blockedSeconds: number; reason: "utilization" | "blocking" } | null;
  waiting: {
    /** Average boxes on belts. */
    avgWip: number;
    /** Average time a box spends on belts (Little's law: avg WIP / arrival rate), seconds. */
    boxQueueSeconds: number;
    /** Total AMR/vehicle seconds waiting for a dock, pallet or assignment. */
    dockWaitSeconds: number;
  };
  congestion: {
    /** Total vehicle seconds yielding/blocked in traffic. */
    trafficWaitSeconds: number;
    /** Busiest floor cells (vehicle-seconds while active, parked vehicles excluded), highest first. */
    hotspots: { x: number; z: number; seconds: number; waitingSeconds: number }[];
  };
};

const BUCKET: Record<OperationState, KpiStateBucket | null> = {
  idle: "idle", charging: "idle", moving: "busy", loading: "busy", unloading: "busy", transferring: "busy",
  waiting: "waiting", blocked: "blocked", error: "blocked", disabled: null,
};
const TRAFFIC = new Set(["yielding", "blocked"]);
/** Parked phases: not floor traffic, so they do not count toward occupancy hotspots. */
const PARKED = new Set(["idle", "charging", "disabled"]);
const HOTSPOTS = 5;
const ZERO: KpiCounters = { boxesIn: 0, placed: 0, passed: 0, palletsIn: 0, palletsShipped: 0, wip: 0 };
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const DEFAULT_KPI_CONFIG: KpiConfig = { interval: 1, cellSize: 2 };

export class KpiCollector {
  private config: KpiConfig = { ...DEFAULT_KPI_CONFIG };
  private next = 0;
  private last = 0;
  private samples = 0;
  private counters: KpiCounters = { ...ZERO };
  private wipSum = 0;
  private dockWait = 0;
  private trafficWait = 0;
  private readonly equipment = new Map<string, KpiEquipmentReport>();
  private readonly cells = new Map<string, { x: number; z: number; seconds: number; waitingSeconds: number }>();

  configure(config: Partial<KpiConfig>) {
    const interval = config.interval ?? this.config.interval, cellSize = config.cellSize ?? this.config.cellSize;
    this.config = { interval: interval > 0 ? interval : DEFAULT_KPI_CONFIG.interval, cellSize: cellSize > 0 ? cellSize : DEFAULT_KPI_CONFIG.cellSize };
  }

  /** Called every fixed step with the sim time; samples (and weights by the interval) when one is due. */
  tick(t: number, sample: () => KpiSample) {
    if (t + 1e-9 < this.next) return;
    const weight = t - this.last;
    this.last = t;
    this.next = t + this.config.interval;
    this.add(sample(), weight);
  }

  private add(sample: KpiSample, dt: number) {
    this.samples++;
    this.counters = { ...sample.counters };
    this.wipSum += sample.counters.wip * dt;
    for (const e of sample.equipment) {
      let row = this.equipment.get(e.id);
      if (!row) this.equipment.set(e.id, (row = { id: e.id, name: e.name, category: e.category, seconds: { busy: 0, idle: 0, waiting: 0, blocked: 0 }, utilization: 0 }));
      const bucket = BUCKET[e.state];
      if (bucket) row.seconds[bucket] += dt;
    }
    const size = this.config.cellSize;
    for (const v of sample.vehicles) {
      const traffic = TRAFFIC.has(v.phase), dock = v.phase === "waiting";
      if (traffic) this.trafficWait += dt;
      if (dock) this.dockWait += dt;
      if (PARKED.has(v.phase)) continue;
      const cx = Math.floor(v.x / size), cz = Math.floor(v.z / size), key = `${cx},${cz}`;
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, (cell = { x: (cx + 0.5) * size, z: (cz + 0.5) * size, seconds: 0, waitingSeconds: 0 }));
      cell.seconds += dt;
      if (traffic) cell.waitingSeconds += dt;
    }
  }

  report(): KpiReport {
    const elapsed = this.last, hours = elapsed / 3600, c = this.counters;
    const rate = (n: number) => (hours > 0 ? n / hours : 0);
    const equipment = [...this.equipment.values()].sort(byId).map((row) => {
      const s = row.seconds, total = s.busy + s.idle + s.waiting + s.blocked;
      return { ...row, seconds: { ...s }, utilization: total > 0 ? s.busy / total : 0 };
    });
    let bottleneck: KpiReport["bottleneck"] = null;
    for (const e of equipment) {
      const better = !bottleneck || e.utilization > bottleneck.utilization + 1e-9
        || (Math.abs(e.utilization - bottleneck.utilization) <= 1e-9 && e.seconds.blocked > bottleneck.blockedSeconds);
      if (better) bottleneck = { id: e.id, name: e.name, utilization: e.utilization, blockedSeconds: e.seconds.blocked, reason: "utilization" };
    }
    // Long blocking outranks a slightly busier but free-flowing machine: blocked time is where flow actually stops.
    const blocker = equipment.reduce<KpiEquipmentReport | null>((best, e) => (e.seconds.blocked > (best?.seconds.blocked ?? 0) ? e : best), null);
    if (blocker && bottleneck && blocker.id !== bottleneck.id && blocker.seconds.blocked > elapsed * 0.25)
      bottleneck = { id: blocker.id, name: blocker.name, utilization: blocker.utilization, blockedSeconds: blocker.seconds.blocked, reason: "blocking" };
    const avgWip = elapsed > 0 ? this.wipSum / elapsed : 0;
    const arrival = elapsed > 0 ? c.boxesIn / elapsed : 0;
    const hotspots = [...this.cells.values()]
      .sort((a, b) => b.seconds - a.seconds || a.x - b.x || a.z - b.z)
      .slice(0, HOTSPOTS)
      .map((cell) => ({ ...cell }));
    return {
      elapsed, samples: this.samples, interval: this.config.interval, counters: { ...c },
      perHour: { boxesIn: rate(c.boxesIn), placed: rate(c.placed), palletsIn: rate(c.palletsIn), palletsShipped: rate(c.palletsShipped) },
      equipment, bottleneck,
      waiting: { avgWip, boxQueueSeconds: arrival > 0 ? avgWip / arrival : 0, dockWaitSeconds: this.dockWait },
      congestion: { trafficWaitSeconds: this.trafficWait, hotspots },
    };
  }
}