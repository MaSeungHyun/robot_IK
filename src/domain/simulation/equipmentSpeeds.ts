import { STREAM_CONFIG } from "@/constants/simulation";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import type { EquipmentKind, EquipmentSettings } from "@/types/layout";

/** Input limits: no upper caps; interval and AMR speed must be > 0. */
export const SPEED_LIMITS = {
  beltSpeed: { min: 0 },
  spawnInterval: { min: 0, exclusiveMin: true },
  amrSpeed: { min: 0, exclusiveMin: true },
} as const;

/**
 * Display units (storage/simulation stay m/s and seconds; convert only on display and commit):
 * conveyor speed in m/s (as stored), box feed as throughput in boxes/h.
 */
/** Belt speed of a newly placed conveyor (m/s); templates/saved scenes keep their own (legacy default 0.25 m/s). */
export const DEFAULT_BELT_SPEED = 1;
export const toMetersPerMinute = (metersPerSecond: number) => metersPerSecond * 60;
export const fromMetersPerMinute = (metersPerMinute: number) => metersPerMinute / 60;
export const toBoxesPerHour = (intervalSeconds: number) => 3600 / intervalSeconds;
export const fromBoxesPerHour = (boxesPerHour: number) => 3600 / boxesPerHour;
/** Rounded for display (≤ 2 decimals). */
export const formatUnit = (value: number) => String(Number(value.toFixed(2)));

/** Beyond these, values are accepted but may cause artifacts; updateSettings logs a WARN. */
export const REALISTIC = { beltSpeed: 2, amrSpeed: 2, minSpawnInterval: 0.1, robotSpeed: 3, reach: SIMULATOR_CONFIG.reach, capacity: 100 } as const;
/** Smallest interval the simulator honors, guarding divide/loop issues with ~0 values. */
const MIN_INTERVAL = 1e-3;

type Config = Pick<EquipmentSettings, "speed" | "spawnInterval"> & Partial<Pick<EquipmentSettings, "beltSpeed" | "amrSpeed">>;

/** Belt velocity (m/s). Legacy settings: base stream speed × multiplier. */
export function beltSpeedOf(config: Config) {
  const speed = config.beltSpeed ?? STREAM_CONFIG.speed * config.speed;
  return Number.isFinite(speed) ? Math.max(0, speed) : 0;
}

/** WARN text for a setting outside the realistic range, or null. */
export function unrealisticWarning(kind: EquipmentKind | undefined, values: Partial<EquipmentSettings>): string | null {
  const notes: string[] = [];
  if (values.beltSpeed !== undefined && values.beltSpeed > REALISTIC.beltSpeed)
    notes.push(`컨베이어 속도 ${formatUnit(values.beltSpeed)} m/s (> ${REALISTIC.beltSpeed} m/s): 박스가 구간/로봇 판정을 건너뛸 수 있습니다`);
  if (values.spawnInterval !== undefined && kind === "conveyor" && values.spawnInterval < REALISTIC.minSpawnInterval)
    notes.push(`박스 투입량 ${formatUnit(toBoxesPerHour(values.spawnInterval))} 개/h (> ${toBoxesPerHour(REALISTIC.minSpawnInterval)} 개/h): 박스가 과도하게 쌓여 느려질 수 있습니다`);
  if (values.amrSpeed !== undefined && values.amrSpeed > REALISTIC.amrSpeed)
    notes.push(`AMR 속도 ${values.amrSpeed} m/s (> ${REALISTIC.amrSpeed}): 경로/충돌 회피가 부정확해질 수 있습니다`);
  if (values.speed !== undefined && kind === "robot" && values.speed > REALISTIC.robotSpeed)
    notes.push(`로봇 속도 ${values.speed}× (> ${REALISTIC.robotSpeed}): 집기 실패나 동작 튐이 생길 수 있습니다`);
  if (values.reach !== undefined && values.reach > REALISTIC.reach)
    notes.push(`집기 범위 ${values.reach} m (> ${REALISTIC.reach}): 로봇 팔이 닿지 않는 박스를 배정할 수 있습니다`);
  if (values.capacity !== undefined && values.capacity > REALISTIC.capacity)
    notes.push(`적재 개수 ${values.capacity} (> ${REALISTIC.capacity}): 적재 계산이 느려질 수 있습니다`);
  return notes.length ? notes.join(" · ") : null;
}

/** Real seconds between inlet boxes. Legacy settings counted belt-scaled time (interval / multiplier). */
/** Conveyor 자동 생성 (absent = legacy on). */
export const autoSpawns = (config: Pick<EquipmentSettings, "autoSpawn"> | undefined) => config?.autoSpawn !== false;

export function spawnIntervalOf(config: Config) {
  const interval = config.beltSpeed === undefined ? config.spawnInterval / (config.speed || 1) : config.spawnInterval;
  return Number.isFinite(interval) ? Math.max(MIN_INTERVAL, interval) : MIN_INTERVAL;
}

/** AMR max speed (m/s). Legacy settings: base AMR speed × multiplier. */
export function amrSpeedOf(config: Config) {
  const speed = config.amrSpeed ?? SIMULATOR_CONFIG.amrSpeed * config.speed;
  return Number.isFinite(speed) ? Math.max(0, speed) : 0;
}

/** AMR speed relative to the base speed the dispatch/traffic logic is tuned for. */
export const amrSpeedFactor = (config: Config) => amrSpeedOf(config) / SIMULATOR_CONFIG.amrSpeed;

/**
 * Simplified options (old layouts/templates keep behaving the same):
 * - robot: old 하역(depalletize) + 정상/불량 filter was really a belt → pallet picker → palletize with that grade.
 *   Depalletizers (pallet → belt, unscanned boxes) drop pickFilter; palletize "all" is dropped (unset = legacy any-grade).
 * - amr: box AMRs → pallet AMRs; boxUnload/emptyPallet removed (empties always go to a forklift);
 *   forkliftRole emptyReturn merged into supply (빈 팔레트 전담).
 * - conveyor: inbound always carries pallets. rack: rackStorage removed (full pallets only). pallet: default capacity 4.
 */
function migrateSimplified(kind: EquipmentKind, input: EquipmentSettings): EquipmentSettings {
  const config = { ...input };
  if (kind === "robot") {
    const filter = config.pickFilter;
    if (config.robotRole === "depalletize" && (filter === "normal" || filter === "defect")) config.robotRole = "palletize";
    if (config.robotRole === "depalletize" || filter === "all") delete config.pickFilter;
  }
  if (kind === "amr") {
    if (config.amrCargo === "box") config.amrCargo = "pallet";
    delete config.boxUnload;
    delete config.emptyPallet;
    if (config.forkliftRole === "emptyReturn") config.forkliftRole = "supply";
  }
  if (kind === "conveyor" && config.conveyorRole === "inbound") config.inboundUnit = "pallet";
  if (kind === "rack") delete config.rackStorage;
  if (kind === "pallet" && (config.capacity === undefined || config.capacity === 40)) config.capacity = 4;
  return config;
}

/**
 * Converts legacy multiplier settings to real units with identical behavior:
 * conveyor speed × → beltSpeed m/s and interval in real seconds; AMR speed × → amrSpeed m/s.
 */
export function migrateSettings(kind: EquipmentKind, config: EquipmentSettings): EquipmentSettings {
  config = migrateSimplified(kind, config);
  // Legacy forklift role "rack" (old layouts) = forklift; the forklift panel only knows "forklift".
  if (kind === "amr" && config.amrRole === "rack") config = { ...config, amrRole: "forklift" };
  if (kind === "conveyor" && config.beltSpeed === undefined)
    return { ...config, beltSpeed: beltSpeedOf(config), spawnInterval: spawnIntervalOf(config), speed: 1 };
  if (kind === "amr" && config.amrSpeed === undefined)
    return { ...config, amrSpeed: amrSpeedOf(config), speed: 1 };
  return config;
}

/** Patch for a real-unit edit; keeps belt speed/interval pinned as real units together. */
export function speedPatch(field: "beltSpeed" | "spawnInterval" | "amrSpeed", value: number, config: Config): Partial<EquipmentSettings> {
  if (field === "amrSpeed") return { amrSpeed: value };
  return field === "beltSpeed"
    ? { beltSpeed: value, spawnInterval: spawnIntervalOf(config) }
    : { spawnInterval: value, beltSpeed: beltSpeedOf(config) };
}
