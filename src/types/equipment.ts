export type EquipmentMetadata = {
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  location?: string;
  ipAddress?: string;
};

export type EquipmentTelemetry = {
  source?: "simulation" | "device";
  connection?: { state: "online" | "offline"; latencyMs?: number };
  motorTemperatureC?: number;
  controllerTemperatureC?: number;
  cycleTimeSeconds?: number;
  powerKw?: number;
  program?: string;
  currentPart?: string;
  operationCount?: number;
};
