export const JOINT_READINGS_INTERVAL_MS = 100;

export const MOCK_TELEMETRY_CONFIG = {
  intervalMs: 1000,
  motorTemperature: { min: 40, max: 65, change: 0.4 },
  controllerTemperature: { min: 35, max: 58, change: 0.3 },
  cycleTime: { min: 10, max: 16, change: 0.2 },
  power: { min: 1.5, max: 4.5, change: 0.15 },
  latency: { min: 8, max: 25, change: 2 },
  initialOperations: { min: 1000, max: 15000 },
  programs: ["PICK_AND_PLACE_01", "PALLETIZE_02", "TRANSFER_03"],
  parts: ["BOX-A01", "BOX-B02", "BOX-C03"],
} as const;
