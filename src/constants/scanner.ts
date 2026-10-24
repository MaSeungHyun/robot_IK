import { SCAN_TUNNEL_MODEL } from "@/constants/modelPoints.generated";

// ScanTunnel.glb as authored (no scaling); "gradient" signal material is optional (the tunnel has none).
export const SCANNER_CONFIG = {
  defaultDefectRate: 0.1,
  signalSeconds: 1,
  scanPointName: SCAN_TUNNEL_MODEL.pointNode,
  materialName: "gradient",
  sampleDistance: 0.05,
  safeToken: "--color-safe",
  faultToken: "--color-fault",
} as const;
