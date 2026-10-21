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
  | "ship";

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

const pad = (value: number, size: number) => String(value).padStart(size, "0");

export class CargoRegistry {
  readonly boxes = new Map<string, BoxRecord>();
  readonly pallets = new Map<string, PalletRecord>();
  readonly misses: CargoMiss[] = [];
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
    const id = e.palletId ?? `P-${pad(this.nextPallet++, 3)}`;
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
    this.touch();
    return id;
  }

  scanBox(e: { t: number; boxId: string; scannerId: string; result: CargoGrade }) {
    const box = this.boxes.get(e.boxId);
    if (!box) return this.missing(e.t, e.scannerId, e.boxId, "스캔");
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
      for (const candidate of this.boxes.values())
        if (candidate.state === "conveyor" && (!e.reachable || e.reachable(candidate)) && (!box || candidate.spawnedAt < box.spawnedAt))
          box = candidate;
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
    this.push(box, { t: e.t, type: "place", equipmentId: e.robotId, palletId: pallet?.id });
  }

  /** A pick attempt failed; the box stays on (or returns to) its belt. */
  missBox(e: { t: number; robotId: string; boxId: string; beltId: string; reason?: string }) {
    const box = this.boxes.get(e.boxId);
    this.misses.push({ t: e.t, equipmentId: e.robotId, boxId: e.boxId, reason: e.reason ?? "집기 실패" });
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
    }
    this.touch();
  }
  /** Full pallet assigned to an AMR (it picks it up and carries it out). */
  dispatchPallet(e: { t: number; palletId: string; amrId: string; destinationId?: string }) {
    const pallet = this.pallets.get(e.palletId);
    if (pallet && e.destinationId) pallet.destination ??= e.destinationId;
    this.palletEvent(e.palletId, "amr", "amr", e.amrId, { t: e.t, type: "dispatch", equipmentId: e.amrId });
  }
  storePallet(e: { t: number; palletId: string; rackId: string; slot?: number }) {
    this.palletEvent(e.palletId, "rack", "rack", e.rackId, {
      t: e.t,
      type: "store",
      equipmentId: e.rackId,
      detail: e.slot === undefined ? undefined : `슬롯 ${e.slot + 1}`,
    });
  }
  dropPallet(e: { t: number; palletId: string; dockId: string }) {
    this.palletEvent(e.palletId, "dock", "dock", e.dockId, { t: e.t, type: "drop", equipmentId: e.dockId });
  }
  shipPallet(e: { t: number; palletId: string; dockId: string }) {
    this.palletEvent(e.palletId, "shipped", "shipped", null, { t: e.t, type: "ship", equipmentId: e.dockId });
  }

  private missing(t: number, equipmentId: string, boxId: string | undefined, what: string) {
    const reason = boxId ? `${what}: 박스 ${boxId}를 찾을 수 없습니다` : what;
    this.misses.push({ t, equipmentId, boxId, reason });
    this.warn(`[${equipmentId}] ${reason} (t=${t.toFixed(1)}s)`);
    this.touch();
    return null;
  }
}
