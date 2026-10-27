import type { Object3D, Vector3 } from "three";
import { SCANNER_CONFIG } from "@/constants/scanner";
import type { EquipmentSettings } from "@/types/layout";
import type { ScanResult, ScanSensor, ScannerSnapshot } from "@/types/scanner";

type SensorState = ScanSensor & {
  snapshot: ScannerSnapshot;
  signalUntil: number;
};

type BoxInspection = { result: ScanResult; scanners: Set<string> };

export class ScannerInspection {
  private sensors = new Map<string, SensorState>();
  private boxes = new WeakMap<Object3D, BoxInspection>();
  /** Boxes that already carry an inspection result elsewhere (cargo record, rack stock): never scanned again. */
  isInspected?: (box: Object3D) => boolean;
  private settings: () => Record<string, EquipmentSettings>;
  private random: () => number;
  private now: () => number;
  /** Called once per scanner a box passes (box id lives on the box node's userData). */
  onScan?: (box: Object3D, scannerId: string, result: ScanResult) => void;

  constructor(
    settings: () => Record<string, EquipmentSettings>,
    random: () => number = Math.random,
    now: () => number = () => performance.now() / 1000,
  ) {
    this.settings = settings;
    this.random = random;
    this.now = now;
  }

  register(id: string, sensor: ScanSensor) {
    this.sensors.set(id, {
      ...sensor,
      snapshot: { id, scanned: 0, faults: 0, lastResult: null },
      signalUntil: 0,
    });

    return () => { this.sensors.delete(id); };
  }

  get active() {
    return this.sensors.size > 0;
  }

  get snapshots(): ScannerSnapshot[] {
    return Array.from(this.sensors.values(), (sensor) => ({ ...sensor.snapshot }));
  }

  getSignal(id: string): ScanResult | null {
    const sensor = this.sensors.get(id);
    return sensor && this.now() < sensor.signalUntil ? sensor.snapshot.lastResult : null;
  }

  /** Result recorded on the box by the first scanner it passed, or null if unscanned. */
  resultOf(box: Object3D): ScanResult | null {
    return this.boxes.get(box)?.result ?? null;
  }

  inspectMovement(box: Object3D, from: Vector3, to: Vector3) {
    if (from.distanceToSquared(to) < 1e-16) return;

    const settings = this.settings();

    for (const [id, sensor] of this.sensors) {
      const config = settings[id];
      if (!config?.enabled || this.boxes.has(box) || this.isInspected?.(box)) continue;

      const start = (from.x - sensor.point.x) * sensor.normal.x + (from.z - sensor.point.z) * sensor.normal.z;
      const end = (to.x - sensor.point.x) * sensor.normal.x + (to.z - sensor.point.z) * sensor.normal.z;
      if (Math.abs(start - end) < 1e-12 || start * end > 0) continue;

      const progress = start / (start - end);
      const x = from.x + (to.x - from.x) * progress - sensor.point.x;
      const z = from.z + (to.z - from.z) * progress - sensor.point.z;
      const y = from.y + (to.y - from.y) * progress;
      const lateral = Math.abs(x * sensor.normal.z - z * sensor.normal.x);
      if (lateral > sensor.halfWidth || y < sensor.floor || y > sensor.point.y) continue;

      let inspection = this.boxes.get(box);
      if (!inspection) {
        const rate = config.defectRate ?? SCANNER_CONFIG.defaultDefectRate;
        inspection = { result: this.random() < rate ? "fault" : "safe", scanners: new Set() };
        this.boxes.set(box, inspection);
      }

      inspection.scanners.add(id);
      sensor.snapshot.scanned++;
      sensor.snapshot.faults += inspection.result === "fault" ? 1 : 0;
      sensor.snapshot.lastResult = inspection.result;
      sensor.signalUntil = this.now() + SCANNER_CONFIG.signalSeconds;
      this.onScan?.(box, id, inspection.result);
    }
  }

  dispose() {
    this.sensors.clear();
    this.boxes = new WeakMap();
  }
}
