export const SCANNER_CONFIG = {
  scale: 0.25,
  defaultDefectRate: 0.1,
  signalSeconds: 1,
  scanPointName: "ScanPoint",
  materialName: "gradient",
  sampleDistance: 0.05,
  safeToken: "--color-safe",
  faultToken: "--color-fault",
} as const;
