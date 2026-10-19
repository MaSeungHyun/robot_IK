import { MOCK_TELEMETRY_CONFIG as CONFIG } from "@/constants/telemetry";
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
): Record<string, EquipmentTelemetry> {
  const readings: Record<string, EquipmentTelemetry> = {};

  for (const object of objects) {
    const last = previous[object.id];
    if (!settings[object.id]?.enabled && last) {
      readings[object.id] = last;
      continue;
    }

    readings[object.id] = {
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
