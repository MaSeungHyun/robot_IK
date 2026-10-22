import type { CargoRegistry } from "@/domain/cargo/CargoRegistry";
import type { TransportQueue } from "@/domain/amr/TransportQueue";
import type { EquipmentSnapshot } from "@/types/simulation";

/** Sim-time bucket length (s) and how many buckets are kept (rolling, bounded memory). */
export const BUCKET_S = 60;
export const BUCKET_LIMIT = 240;
/** Buckets compared for the "직전 구간 대비" change (last N complete vs the N before). */
export const COMPARE_BUCKETS = 5;

export type TimeShareKey = "run" | "move" | "wait" | "charge" | "fault";
export type TimeShare = Record<TimeShareKey, number>;

export type DashboardBucket = {
  /** Bucket start, simulation seconds. */
  t: number;
  inbound: number;
  outbound: number;
  scanned: number;
  defects: number;
  /** Active (run + move) / tracked equipment seconds in this bucket. */
  activeSeconds: number;
  trackedSeconds: number;
};

export type DashboardEquipment = {
  id: string;
  name: string;
  kind: "robot" | "amr";
  state: string;
  /** Robot: boxes placed; AMR: completed transports. */
  count: number;
  perHour: number | null;
  /** Active share 0..100 of the tracked time. */
  utilization: number | null;
  timeShare: TimeShare;
};

/** Serializable dashboard state (e.g. for later AI analysis). All ratios are 0..100. */
export type DashboardSnapshot = {
  elapsed: number;
  bucketSeconds: number;
  kpi: {
    throughputPerHour: number | null;
    inbound: number;
    outbound: number;
    outboundPallets: number;
    inboundChangePct: number | null;
    outboundChangePct: number | null;
    defectRate: number | null;
    quality: number | null;
    utilization: number | null;
    availability: number | null;
    oee: number | null;
    avgLeadTimeS: number | null;
  };
  timeShare: TimeShare;
  buckets: DashboardBucket[];
  bottleneck: {
    transportQueued: number;
    transportAvgWaitS: number | null;
    conveyorQueued: number;
    pickupWaitAvgS: number | null;
  };
  equipment: DashboardEquipment[];
};

const MOVE_STATES = new Set(["pickup", "loading", "dispatch", "unloading", "storing", "returning"]);
const WAIT_STATES = new Set(["idle", "waiting", "yielding"]);
const emptyShare = (): TimeShare => ({ run: 0, move: 0, wait: 0, charge: 0, fault: 0 });
const sum = (share: TimeShare) => share.run + share.move + share.wait + share.charge + share.fault;
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
const change = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

function shareKey(kind: "robot" | "amr", state: string): TimeShareKey | null {
  if (state === "disabled") return null;
  if (kind === "robot") return state === "working" ? "run" : "wait";
  if (MOVE_STATES.has(state)) return "move";
  if (state === "charging") return "charge";
  if (state === "blocked") return "fault";
  return WAIT_STATES.has(state) ? "wait" : "wait";
}

/**
 * Accumulates equipment snapshots + cargo totals into sim-time buckets. Plain mutable class fed
 * at the HUD report rate; `snapshot()` builds the serializable view on demand.
 */
export class DashboardSampler {
  private elapsed = 0;
  private units = new Map<string, TimeShare>();
  private buckets: DashboardBucket[] = [];
  private totals = { inbound: 0, outbound: 0, scanned: 0, defects: 0 };
  private last: EquipmentSnapshot | null = null;

  reset() {
    this.elapsed = 0;
    this.units.clear();
    this.buckets = [];
    this.totals = { inbound: 0, outbound: 0, scanned: 0, defects: 0 };
    this.last = null;
  }

  private bucketAt(t: number) {
    const start = Math.floor(t / BUCKET_S) * BUCKET_S;
    let bucket = this.buckets[this.buckets.length - 1];
    if (!bucket || bucket.t !== start) {
      bucket = { t: start, inbound: 0, outbound: 0, scanned: 0, defects: 0, activeSeconds: 0, trackedSeconds: 0 };
      this.buckets.push(bucket);
      if (this.buckets.length > BUCKET_LIMIT) this.buckets.shift();
    }
    return bucket;
  }

  sample(snapshot: EquipmentSnapshot, cargo: CargoRegistry | null) {
    if (snapshot.elapsed < this.elapsed) this.reset();
    const dt = snapshot.elapsed - this.elapsed;
    this.last = snapshot;
    if (dt <= 0) return;
    this.elapsed = snapshot.elapsed;
    const bucket = this.bucketAt(snapshot.elapsed - 1e-6);
    const track = (id: string, kind: "robot" | "amr", state: string) => {
      const key = shareKey(kind, state);
      if (!key) return;
      const share = this.units.get(id) ?? emptyShare();
      share[key] += dt;
      this.units.set(id, share);
      bucket.trackedSeconds += dt;
      if (key === "run" || key === "move") bucket.activeSeconds += dt;
    };
    for (const robot of snapshot.robots) track(robot.id, "robot", robot.state);
    for (const agent of snapshot.agents) track(agent.id, "amr", agent.state);
    if (cargo) {
      const t = cargo.totals;
      bucket.inbound += t.inbound - this.totals.inbound;
      bucket.outbound += t.outboundBoxes - this.totals.outbound;
      bucket.scanned += t.scanned - this.totals.scanned;
      bucket.defects += t.defects - this.totals.defects;
      this.totals = { inbound: t.inbound, outbound: t.outboundBoxes, scanned: t.scanned, defects: t.defects };
    }
  }

  snapshot(cargo: CargoRegistry | null, transport: TransportQueue | null): DashboardSnapshot {
    const elapsed = this.elapsed, snapshot = this.last;
    const timeShare = emptyShare();
    for (const share of this.units.values()) for (const key of Object.keys(timeShare) as TimeShareKey[]) timeShare[key] += share[key];
    const tracked = sum(timeShare);
    const totals = cargo?.totals;
    const utilization = pct(timeShare.run + timeShare.move, tracked);
    const availability = tracked > 0 ? 100 - (pct(timeShare.fault, tracked) ?? 0) : null;
    const defectRate = totals && totals.scanned ? (totals.defects / totals.scanned) * 100 : null;
    const quality = defectRate === null ? (totals ? 100 : null) : 100 - defectRate;
    const oee = utilization !== null && availability !== null && quality !== null ? (availability / 100) * (utilization / 100) * (quality / 100) * 100 : null;

    // Last COMPARE_BUCKETS complete buckets vs the COMPARE_BUCKETS before them.
    const complete = this.buckets.filter((b) => b.t + BUCKET_S <= elapsed);
    const recent = complete.slice(-COMPARE_BUCKETS), before = complete.slice(-2 * COMPARE_BUCKETS, -COMPARE_BUCKETS);
    const total = (list: DashboardBucket[], key: "inbound" | "outbound") => list.reduce((s, b) => s + b[key], 0);
    const comparable = before.length === COMPARE_BUCKETS;

    const tasks = transport?.list() ?? [];
    const queued = tasks.filter((task) => task.state === "queued");
    const assigned = tasks.filter((task) => task.assignedAt !== undefined);
    const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
    let conveyorQueued = 0;
    if (cargo) for (const id of cargo.activeBoxes) if (cargo.boxes.get(id)?.state === "conveyor") conveyorQueued++;

    const equipment: DashboardEquipment[] = [];
    const perHour = (count: number) => (elapsed >= 60 ? (count / elapsed) * 3600 : null);
    for (const robot of snapshot?.robots ?? []) {
      const share = this.units.get(robot.id) ?? emptyShare();
      equipment.push({ id: robot.id, name: robot.name, kind: "robot", state: robot.state, count: robot.count, perHour: perHour(robot.count), utilization: pct(share.run, sum(share)), timeShare: { ...share } });
    }
    for (const agent of snapshot?.agents ?? []) {
      const share = this.units.get(agent.id) ?? emptyShare();
      equipment.push({ id: agent.id, name: agent.name, kind: "amr", state: agent.state, count: agent.completed, perHour: perHour(agent.completed), utilization: pct(share.move, sum(share)), timeShare: { ...share } });
    }

    return {
      elapsed,
      bucketSeconds: BUCKET_S,
      kpi: {
        throughputPerHour: totals && elapsed >= 60 ? (totals.outboundBoxes / elapsed) * 3600 : null,
        inbound: totals?.inbound ?? 0,
        outbound: totals?.outboundBoxes ?? 0,
        outboundPallets: totals?.outboundPallets ?? 0,
        inboundChangePct: comparable ? change(total(recent, "inbound"), total(before, "inbound")) : null,
        outboundChangePct: comparable ? change(total(recent, "outbound"), total(before, "outbound")) : null,
        defectRate,
        quality,
        utilization,
        availability,
        oee,
        avgLeadTimeS: totals && totals.outboundBoxes ? totals.leadTimeSum / totals.outboundBoxes : null,
      },
      timeShare,
      buckets: this.buckets.map((b) => ({ ...b })),
      bottleneck: {
        transportQueued: queued.length,
        transportAvgWaitS: average(queued.map((task) => elapsed - task.createdAt)),
        conveyorQueued,
        pickupWaitAvgS: average(assigned.map((task) => task.assignedAt! - task.createdAt)),
      },
      equipment,
    };
  }
}