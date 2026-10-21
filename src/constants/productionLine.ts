/** Production-line overview (display only). */
export const PRODUCTION_LINE = {
  /** Max distance (m) from a belt centerline for a scanner to count as on that line. */
  scannerSnapDistance: 0.5,
  /** Simulated seconds between production-rate history samples. */
  historyStepS: 5,
  /** Number of history samples kept (rolling window = step × count). */
  historyLength: 36,
  /** Robot status phases counted as transfer (carrying a box between belt and pallet). */
  transferPhases: ["LIFT", "TRANSIT", "RETREAT"],
} as const;
