import type { CargoGrade } from "@/types/layout";

/**
 * Per-box / per-pallet records for the end of the production line. The simulator calls the event
 * functions below as things happen; a future replay mode can call the same functions from
 * recorded or live equipment events. Mutable on purpose (hundreds of boxes, updated per frame):
 * the UI reads it on demand and re-renders on the throttled `version` in useCargoStore.
 */
export type BoxState =
  | "conveyor" // on a belt (moving or waiting for a robot)
  | "robot" // reserved/held by a robot
  | "pallet" // placed on a pallet that is still loading
  | "amr" // pallet assigned to / carried by an AMR
  | "rack" // pallet stored in a rack slot
  | "dock" // pallet dropped on an outbound dock
  | "shipped" // pallet cleared from the dock
  | "passed"; // left the end of the line unpicked

export type BoxEventType =
  | "spawn"
  | "scan"
  | "reserve"
  | "pick"
  | "place"
  | "miss"
  | "pass"
  | "dispatch"
  | "store"
  | "drop"
  | "ship"
  | "unload";

export type BoxEvent = {
  /** Simulation time in seconds. */
  t: number;
  type: BoxEventType;
  /** Equipment that caused the event (belt, scanner, robot, AMR, rack, dock). */
  equipmentId?: string;
  palletId?: string;
  detail?: string;
};

export type BoxRecord = {
  id: string;
  spawnedAt: number;
  /** Scan result; null until a scanner has inspected the box. */
  inspection: CargoGrade | null;
  state: BoxState;
  /** Equipment currently holding the box (belt, robot, pallet station, AMR, rack, dock). */
  holder: string | null;
  palletId: string | null;
  destination?: string;
  history: BoxEvent[];
};

/**
 * Detailed box stage (finer than BoxState): combines where the box is with its inspection result and history.
 * Derived on read (no stored field), so old records and replays get it too.
 */
export type BoxStage =
  | "awaitingScan" // on a belt, not inspected yet
  | "inboundAwaitingScan" // unloaded from an inbound pallet onto a belt, not inspected yet
  | "scannedNormal" // on a belt, passed inspection
  | "scannedDefect" // on a belt, inspected as defect (goes to the defect pallet)
  | "assigned" // a robot has reserved it
  | "held" // in a robot gripper
  | "palletizedNormal" // on a loading pallet (normal)
  | "palletizedDefect" // on a loading pallet (defect)
  | "inTransit" // pallet on an AMR / forklift
  | "stored" // in a rack slot
  | "outboundStaged" // on an outbound dock
  | "shipped"
  | "passedUnprocessed"; // left the line unpicked
export function boxStage(box: BoxRecord): BoxStage {
  switch (box.state) {
    case "passed": return "passedUnprocessed";
    case "shipped": return "shipped";
    case "dock": return "outboundStaged";
    case "rack": return "stored";
    case "amr": return "inTransit";
    case "pallet": return box.inspection === "defect" ? "palletizedDefect" : "palletizedNormal";
    case "robot": return box.history[box.history.length - 1]?.type === "pick" ? "held" : "assigned";
    case "conveyor":
      if (box.inspection === "defect") return "scannedDefect";
      if (box.inspection === "normal") return "scannedNormal";
      return box.history.some((e) => e.type === "unload") ? "inboundAwaitingScan" : "awaitingScan";
  }
}

export type PalletRecord = {
  id: string;
  /** Pallet station (equipment) the pallet was loaded on. */
  stationId: string;
  /** 적재 용도. */
  grade: CargoGrade;
  destination?: string;
  boxIds: string[];
  state: "loading" | "amr" | "rack" | "dock" | "shipped";
  createdAt: number;
};

export type CargoMiss = { t: number; equipmentId: string; boxId?: string; reason: string };

/** Flat processing log (dashboard 처리 내역): one row per line-level cargo/transport event. */
export type CargoLogType = "inbound" | "scanPass" | "scanDefect" | "load" | "palletFull" | "pickup" | "outbound";
export type CargoLogEntry = {
  no: number;
  /** Simulation time in seconds. */
  t: number;
  type: CargoLogType;
  /** Box (B-xxxx) or pallet (PLT-xxxx) id. */
  targetId: string;
  from?: string;
  to?: string;
  equipmentId?: string;
  status: "완료" | "진행" | "불량";
};
/** Rows kept in the log (oldest dropped); totals below stay exact. */
const LOG_LIMIT = 5000;
/** Misses kept (oldest dropped). */
const MISS_LIMIT = 500;
/** Finished (passed/shipped) records kept for lookup; older ones are evicted, totals stay exact. */
const FINISHED_BOX_LIMIT = 1000;
const FINISHED_PALLET_LIMIT = 100;

const pad = (value: number, size: number) => String(value).padStart(size, "0");

export class CargoRegistry {
  readonly boxes = new Map<string, BoxRecord>();
  readonly pallets = new Map<string, PalletRecord>();
  readonly misses: CargoMiss[] = [];
  readonly log: CargoLogEntry[] = [];
  /** Exact cumulative counts (independent of the bounded log). */
  /** Ids of boxes still in the scene (not passed/shipped): bounded by the line, not by run time. */
  readonly activeBoxes = new Set<string>();
  private finishedBoxes: string[] = [];
  private finishedPallets: string[] = [];
  readonly totals = { inbound: 0, scanned: 0, defects: 0, loaded: 0, palletsFull: 0, pickups: 0, outboundPallets: 0, outboundBoxes: 0, leadTimeSum: 0 };
  private nextLog = 1;
  /** Bumped on every change; the UI polls it at a throttled rate. */
  version = 0;
  /** Current (loading) pallet record per pallet station. */
  private current = new Map<string, string>();
  private nextBox = 1;
  private nextPallet = 1;
  /** Optional WARN sink (the app log); kept injectable so the domain has no UI dependency. */
  private warn: (message: string) => void;
  constructor(warn: (message: string) => void = () => {}) {
    this.warn = warn;
  }

  private record(entry: Omit<CargoLogEntry, "no">) {
    this.log.push({ no: this.nextLog++, ...entry });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }
  private addMiss(miss: CargoMiss) {
    this.misses.push(miss);
    if (this.misses.length > MISS_LIMIT) this.misses.splice(0, this.misses.length - MISS_LIMIT);
  }
  /** A box left the scene: drop it from the active set and evict the oldest finished records. */
  private finishBox(id: string) {
    if (!this.activeBoxes.delete(id)) return;
    this.finishedBoxes.push(id);
    if (this.finishedBoxes.length > FINISHED_BOX_LIMIT)
      for (const old of this.finishedBoxes.splice(0, this.finishedBoxes.length - FINISHED_BOX_LIMIT)) this.boxes.delete(old);
  }
  private finishPallet(id: string) {
    this.finishedPallets.push(id);
    if (this.finishedPallets.length > FINISHED_PALLET_LIMIT)
      for (const old of this.finishedPallets.splice(0, this.finishedPallets.length - FINISHED_PALLET_LIMIT)) this.pallets.delete(old);
  }
  private touch() {
    this.version++;
  }
  private push(box: BoxRecord, event: BoxEvent) {
    box.history.push(event);
    this.touch();
  }
  box(id: string | null | undefined) {
    return id ? this.boxes.get(id) : undefined;
  }
  pallet(id: string | null | undefined) {
    return id ? this.pallets.get(id) : undefined;
  }
  /** Pallet record currently loading on a pallet station. */
  currentPallet(stationId: string) {
    return this.pallet(this.current.get(stationId));
  }

  /** A new (empty) pallet on a station; the previous one keeps its own id and record. */
  startPallet(e: { t: number; stationId: string; grade: CargoGrade; palletId?: string; destination?: string }) {
    // Sequential in creation order (deterministic: sim steps are speed-independent).
    const id = e.palletId ?? `PLT-${pad(this.nextPallet++, 4)}`;
    this.pallets.set(id, {
      id,
      stationId: e.stationId,
      grade: e.grade,
      destination: e.destination,
      boxIds: [],
      state: "loading",
      createdAt: e.t,
    });
    this.current.set(e.stationId, id);
    this.touch();
    return id;
  }

  spawnBox(e: { t: number; beltId: string; boxId?: string; destination?: string }) {
    const id = e.boxId ?? `B-${pad(this.nextBox++, 4)}`;
    this.boxes.set(id, {
      id,
      spawnedAt: e.t,
      inspection: null,
      state: "conveyor",
      holder: e.beltId,
      palletId: null,
      destination: e.destination,
      history: [{ t: e.t, type: "spawn", equipmentId: e.beltId }],
    });
    this.activeBoxes.add(id);
    this.totals.inbound++;
    this.record({ t: e.t, type: "inbound", targetId: id, to: e.beltId, equipmentId: e.beltId, status: "완료" });
    this.touch();
    return id;
  }

  scanBox(e: { t: number; boxId: string; scannerId: string; result: CargoGrade }) {
    const box = this.boxes.get(e.boxId);
    if (!box) return this.missing(e.t, e.scannerId, e.boxId, "스캔");
    if (box.inspection === null) {
      this.totals.scanned++;
      if (e.result === "defect") this.totals.defects++;
      this.record({ t: e.t, type: e.result === "defect" ? "scanDefect" : "scanPass", targetId: box.id, from: box.holder ?? undefined, equipmentId: e.scannerId, status: e.result === "defect" ? "불량" : "완료" });
    }
    box.inspection ??= e.result;
    this.push(box, { t: e.t, type: "scan", equipmentId: e.scannerId, detail: e.result === "defect" ? "불량" : "정상" });
  }

  /**
   * Robot takes a box. Without `boxId` (replay without box ids) the first-spawned box still on a
   * conveyor that `reachable` accepts is used; none is recorded as a miss and logged as WARN.
   */
  pickBox(e: { t: number; robotId: string; boxId?: string; reachable?: (box: BoxRecord) => boolean }) {
    let box = this.box(e.boxId);
    if (!box && !e.boxId)
      for (const candidate of this.activeBoxes) {
        const record = this.boxes.get(candidate);
        if (record && record.state === "conveyor" && (!e.reachable || e.reachable(record)) && (!box || record.spawnedAt < box.spawnedAt))
          box = record;
      }
    if (!box || (box.state !== "conveyor" && box.state !== "robot"))
      return this.missing(e.t, e.robotId, e.boxId, "집을 박스가 없습니다");
    box.state = "robot";
    box.holder = e.robotId;
    this.push(box, { t: e.t, type: "pick", equipmentId: e.robotId });
    return box.id;
  }

  /** Robot committed to a box on the belt (simulation only; replay can skip it). */
  reserveBox(e: { t: number; robotId: string; boxId: string }) {
    const box = this.boxes.get(e.boxId);
    if (!box) return;
    this.push(box, { t: e.t, type: "reserve", equipmentId: e.robotId });
  }

  /** Box placed onto the pallet loading on `stationId` (aggregation). */
  placeBox(e: { t: number; robotId: string; boxId: string; stationId: string }) {
    const box = this.boxes.get(e.boxId),
      pallet = this.currentPallet(e.stationId);
    if (!box) return this.missing(e.t, e.robotId, e.boxId, "적재");
    box.state = "pallet";
    box.holder = e.stationId;
    box.palletId = pallet?.id ?? null;
    if (pallet && !pallet.boxIds.includes(box.id)) pallet.boxIds.push(box.id);
    this.totals.loaded++;
    this.record({ t: e.t, type: "load", targetId: box.id, from: box.history.find((h) => h.type === "spawn")?.equipmentId, to: e.stationId, equipmentId: e.robotId, status: "완료" });
    this.push(box, { t: e.t, type: "place", equipmentId: e.robotId, palletId: pallet?.id });
  }

  /** A pick attempt failed; the box stays on (or returns to) its belt. */
  missBox(e: { t: number; robotId: string; boxId: string; beltId: string; reason?: string }) {
    const box = this.boxes.get(e.boxId);
    this.addMiss({ t: e.t, equipmentId: e.robotId, boxId: e.boxId, reason: e.reason ?? "집기 실패" });
    if (!box) return;
    box.state = "conveyor";
    box.holder = e.beltId;
    this.push(box, { t: e.t, type: "miss", equipmentId: e.robotId, detail: e.reason });
  }

  /** Box ran off the end of the line without being picked. */
  passBox(e: { t: number; boxId: string; beltId: string }) {
    const box = this.boxes.get(e.boxId);
    if (!box) return;
    box.state = "passed";
    box.holder = null;
    this.push(box, { t: e.t, type: "pass", equipmentId: e.beltId });
    this.finishBox(box.id);
  }

  /** Belt-to-belt hand-over keeps the holder current (no history entry). */
  moveBox(boxId: string, beltId: string) {
    const box = this.boxes.get(boxId);
    if (!box || box.holder === beltId) return;
    box.holder = beltId;
    this.touch();
  }

  private palletEvent(palletId: string, state: PalletRecord["state"], boxState: BoxState, holder: string | null, event: BoxEvent) {
    const pallet = this.pallets.get(palletId);
    if (!pallet) return;
    pallet.state = state;
    if (state !== "loading" && this.current.get(pallet.stationId) === palletId) this.current.delete(pallet.stationId);
    for (const id of pallet.boxIds) {
      const box = this.boxes.get(id);
      if (!box) continue;
      box.state = boxState;
      box.holder = holder;
      box.history.push({ ...event, palletId });
      if (boxState === "shipped") this.finishBox(id);
    }
    if (state === "shipped") this.finishPallet(palletId);
    this.touch();
  }
  /** The loading pallet on `stationId` reached capacity (waits for transport). */
  completePallet(e: { t: number; stationId: string }) {
    const pallet = this.currentPallet(e.stationId);
    if (!pallet) return;
    this.totals.palletsFull++;
    this.record({ t: e.t, type: "palletFull", targetId: pallet.id, from: e.stationId, equipmentId: e.stationId, status: "진행" });
    this.touch();
  }
  private outbound(t: number, palletId: string, destinationId: string) {
    const pallet = this.pallets.get(palletId);
    if (!pallet) return;
    this.totals.outboundPallets++;
    for (const id of pallet.boxIds) {
      const box = this.boxes.get(id);
      if (!box) continue;
      this.totals.outboundBoxes++;
      this.totals.leadTimeSum += t - box.spawnedAt;
    }
    this.record({ t, type: "outbound", targetId: palletId, from: pallet.stationId, to: destinationId, equipmentId: destinationId, status: "완료" });
  }
  /** Full pallet assigned to an AMR (it picks it up and carries it out). */
  dispatchPallet(e: { t: number; palletId: string; amrId: string; destinationId?: string }) {
    const pallet = this.pallets.get(e.palletId);
    if (pallet && e.destinationId) pallet.destination ??= e.destinationId;
    this.totals.pickups++;
    this.record({ t: e.t, type: "pickup", targetId: e.palletId, from: pallet?.stationId, to: e.destinationId, equipmentId: e.amrId, status: "진행" });
    this.palletEvent(e.palletId, "amr", "amr", e.amrId, { t: e.t, type: "dispatch", equipmentId: e.amrId });
  }
  storePallet(e: { t: number; palletId: string; rackId: string; slot?: number }) {
    this.outbound(e.t, e.palletId, e.rackId);
    this.palletEvent(e.palletId, "rack", "rack", e.rackId, {
      t: e.t,
      type: "store",
      equipmentId: e.rackId,
      detail: e.slot === undefined ? undefined : `슬롯 ${e.slot + 1}`,
    });
  }
  dropPallet(e: { t: number; palletId: string; dockId: string }) {
    this.outbound(e.t, e.palletId, e.dockId);
    this.palletEvent(e.palletId, "dock", "dock", e.dockId, { t: e.t, type: "drop", equipmentId: e.dockId });
  }
  /** Pallet delivered to an unload (depalletizing) dock: not an outbound shipment. */
  arrivePallet(e: { t: number; palletId: string; dockId: string }) {
    this.palletEvent(e.palletId, "dock", "dock", e.dockId, { t: e.t, type: "drop", equipmentId: e.dockId });
  }
  /** Depalletizing robot takes a box off a delivered pallet. */
  takeFromPallet(e: { t: number; robotId: string; boxId: string }) {
    const box = this.boxes.get(e.boxId);
    if (!box) return this.missing(e.t, e.robotId, e.boxId, "하역");
    box.state = "robot";
    box.holder = e.robotId;
    this.push(box, { t: e.t, type: "pick", equipmentId: e.robotId, palletId: box.palletId ?? undefined });
    return box.id;
  }
  /** The depalletized box is on a belt again (it leaves its old pallet). */
  unloadBox(e: { t: number; robotId: string; boxId: string; beltId: string }) {
    const box = this.boxes.get(e.boxId);
    if (!box) return this.missing(e.t, e.robotId, e.boxId, "컨베이어 투입");
    const pallet = this.pallet(box.palletId);
    if (pallet) pallet.boxIds = pallet.boxIds.filter((id) => id !== box.id);
    box.state = "conveyor";
    box.holder = e.beltId;
    box.palletId = null;
    this.push(box, { t: e.t, type: "unload", equipmentId: e.robotId });
  }
  /** The emptied pallet left the unload dock. */
  emptyPallet(e: { t: number; palletId: string }) {
    const pallet = this.pallets.get(e.palletId);
    if (!pallet) return;
    pallet.state = "shipped";
    this.finishPallet(pallet.id);
    this.touch();
  }
  shipPallet(e: { t: number; palletId: string; dockId: string }) {
    this.palletEvent(e.palletId, "shipped", "shipped", null, { t: e.t, type: "ship", equipmentId: e.dockId });
  }

  private missing(t: number, equipmentId: string, boxId: string | undefined, what: string) {
    const reason = boxId ? `${what}: 박스 ${boxId}를 찾을 수 없습니다` : what;
    this.addMiss({ t, equipmentId, boxId, reason });
    this.warn(`[${equipmentId}] ${reason} (t=${t.toFixed(1)}s)`);
    this.touch();
    return null;
  }
}
