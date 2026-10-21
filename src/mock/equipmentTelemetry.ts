import { AMR_LOADED_STATES, MOCK_TELEMETRY_CONFIG as CONFIG } from "@/constants/telemetry";
import type { EquipmentTelemetry } from "@/types/equipment";
import type { EquipmentSettings, SceneEquipment } from "@/types/layout";

type Range = { min: number; max: number; change?: number };

function randomValue(range: Range, random: () => number) {
  return range.min + random() * (range.max - range.min);
}

function drift(previous: number | undefined, range: Range, random: () => number) {
  const value = previous === undefined ? randomValue(range, random)
    : previous + (random() - 0.5) * 2 * (range.change ?? 0);

  return Math.round(Math.max(range.min, Math.min(range.max, value)) * 10) / 10;
}

export function createMockTelemetry(
  objects: SceneEquipment[],
  settings: Record<string, EquipmentSettings>,
  previous: Record<string, EquipmentTelemetry>,
  random: () => number = Math.random,
  /** Live equipment state by id (robot "working", AMR state), used to decide holding / carrying. */
  states: Record<string, string> = {},
): Record<string, EquipmentTelemetry> {
  const readings: Record<string, EquipmentTelemetry> = {};

  for (const object of objects) {
    const last = previous[object.id];
    if (!settings[object.id]?.enabled && last) {
      readings[object.id] = last;
      continue;
    }

    readings[object.id] = {
      ...mockExtras(object.kind, states[object.id], last, random),
      source: "simulation",
      connection: { state: "online", latencyMs: Math.round(drift(last?.connection?.latencyMs, CONFIG.latency, random)) },
      motorTemperatureC: drift(last?.motorTemperatureC, CONFIG.motorTemperature, random),
      controllerTemperatureC: drift(last?.controllerTemperatureC, CONFIG.controllerTemperature, random),
      cycleTimeSeconds: drift(last?.cycleTimeSeconds, CONFIG.cycleTime, random),
      powerKw: drift(last?.powerKw, CONFIG.power, random),
      program: last?.program ?? CONFIG.programs[Math.floor(random() * CONFIG.programs.length)],
      currentPart: last?.currentPart ?? CONFIG.parts[Math.floor(random() * CONFIG.parts.length)],
      operationCount: last?.operationCount === undefined
        ? Math.floor(randomValue(CONFIG.initialOperations, random))
        : last.operationCount + (random() > 0.5 ? 1 : 0),
    };
  }

  return readings;
}

const isLoaded = (state: string | undefined) => (AMR_LOADED_STATES as readonly string[]).includes(state ?? "");

/** Mock-only extras per equipment kind; the simulator models none of these physically. */
function mockExtras(kind: string, state: string | undefined, last: EquipmentTelemetry | undefined, random: () => number): EquipmentTelemetry {
  if (kind === "robot") {
    const holding = state === "working";
    return {
      jointLoadPercent: Array.from({ length: CONFIG.jointCount }, (_, index) =>
        drift(last?.jointLoadPercent?.[index], CONFIG.jointLoad, random)),
      suctionKPa: drift(last?.suctionKPa, holding ? CONFIG.suctionHolding : CONFIG.suctionIdle, random),
      heldBoxKg: holding ? (last?.heldBoxKg || drift(undefined, CONFIG.boxWeight, random)) : 0,
    };
  }
  if (kind === "amr") {
    return { payloadKg: isLoaded(state) ? (last?.payloadKg || drift(undefined, CONFIG.payload, random)) : 0 };
  }
  if (kind === "conveyor") return { motorLoadPercent: drift(last?.motorLoadPercent, CONFIG.motorLoad, random) };
  return {};
}
