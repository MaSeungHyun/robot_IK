import { CONVEYOR_LAYOUT } from "@/constants/conveyorLayoutConfig";
import { STREAM_CONFIG } from "@/constants/simulation";

/**
 * 입하/출하 컨베이어 (rail.glb 그대로, 스케일 변경 없음) and the AMR top-roller transfer.
 * An AMR docks on the transfer point in front of a belt end and its top roller conveyor rolls the
 * pallet across (AMR -> outbound belt start), so no lift / fork motion is involved.
 */
export const PALLET_CONVEYOR = {
  /** Accent of the inbound / outbound conveyor markings (#02dfef, not blue). */
  accent: "#02dfef",
  /** Transfer point: AMR centre this far upstream of the belt start (m), on the belt axis. */
  transferOffset: STREAM_CONFIG.palletDepth / 2 + 1.25,
  /** Pallet travel speed on the outbound belt when the belt has no speed set (m/s). */
  palletSpeed: 0.6,
  /** Clear distance (m) between pallets queued on the outbound belt. */
  palletGap: STREAM_CONFIG.palletDepth + 0.3,
  /** Roll-over from the AMR top onto the belt start (s). */
  transferSeconds: 2,
  /** Pallets on an outbound belt at once (accumulation queue length). */
  maxPallets: Math.max(1, Math.floor(CONVEYOR_LAYOUT.length / (STREAM_CONFIG.palletDepth + 0.3))),
  /** Depalletizing: drop distance before the belt end (m) when the robot can reach it. */
  dropBeforeEnd: 2,
} as const;
