import { BOX_SIZES, PALLET_STACKING, STREAM_CONFIG } from "@/constants/simulation";
import { CONVEYOR_LAYOUT } from "@/constants/conveyorLayoutConfig";
import { AMR_MODEL } from "@/constants/modelPoints.generated";

/**
 * Pallet cycle (입하 AMR 적재 → 스캔 → Rack_m → 랙 → 출하) equipment in metres.
 * AGV and Rack_m are procedural placeholders (src/lib/three/cycleModels.ts) with real-world sizes;
 * a GLB can replace them later as long as it keeps these origins (floor centre, forward = local +Z,
 * Rack_m loading face = local +X like Rack.glb).
 */
const loadHeight = STREAM_CONFIG.palletHeight + PALLET_STACKING.layers * BOX_SIZES[0].y;

export const CYCLE_ACCENT = "#02dfef";

/** AMR top (pallet bottom) while the AMR carries a pallet: AMR.glb's AMR_point seat height. */
export const AMR_DECK = AMR_MODEL.deck[1];

/** Low-profile lifting AGV that drives under a Rack_m and lifts it (Kiva-type, ~1.3 x 1.0 x 0.3 m). */
/**
 * Roller-top module on a shuttle AMR fed by a pallet-unit inbound conveyor (inboundUnit "pallet"):
 * the roller bed top = the belt surface of rail.glb (CONVEYOR_LAYOUT.height, derived from the model,
 * nothing rescaled), so a loaded pallet rolls straight from the belt end onto the AMR.
 */
export const ROLLER_DECK = CONVEYOR_LAYOUT.height;
export const ROLLER_TOP_MODEL = {
  width: STREAM_CONFIG.palletWidth + 0.1,
  length: STREAM_CONFIG.palletDepth + 0.1,
  /** Module height above the AMR top (AMR_DECK) up to the roller surface. */
  height: +(CONVEYOR_LAYOUT.height - AMR_DECK).toFixed(4),
  rollerPitch: 0.12,
  rollerRadius: 0.03,
} as const;

export const AGV_MODEL = {
  width: 1.0,
  length: 1.3,
  height: 0.3,
  /** Lift plate stroke (m) when it raises a Rack_m off the floor. */
  liftStroke: 0.05,
  liftSpeed: 0.1,
  speed: 1.2,
  radius: Math.hypot(0.5, 0.65),
} as const;

/** Mobile rack (Rack_m): 4 legs, two pallet levels, AGV clearance under the bottom level. */
export const RACK_M_MODEL = {
  width: 1.45,
  depth: 1.45,
  /** Pallet bottom heights (m) of the levels; level 1 sits above the AGV (height + stroke + margin). */
  levels: [0.45, +(0.45 + loadHeight + 0.3).toFixed(3)] as readonly number[],
  get height() {
    return this.levels[this.levels.length - 1] + loadHeight + 0.25;
  },
  post: 0.06,
  /** Loaded body radius while an AGV carries it. */
  radius: Math.hypot(0.725, 0.725),
} as const;

export const CYCLE_CONFIG = {
  /** Shuttle AMR / forklift travel speeds (m/s). */
  shuttleSpeed: 1.6,
  forkliftSpeed: 1.4,
  turnRate: Math.PI / 2,
  /** Slow straight moves while docking / forks in or out (m/s). */
  creepSpeed: 0.35,
  /** Fork raise / lower speed (m/s) and the lift above a support while inserting / leaving. */
  forkSpeed: 0.45,
  forkClearance: 0.08,
  /** Gap (m) left between tine tips and the pallet before driving the forks in. */
  standoffGap: 0.45,
  /** Traffic: bodies keep this gap; after holdTimeout s a vehicle replans, after giveUp s it proceeds (counted). */
  safetyGap: 0.15,
  /** AMR footprint keep-out radius (same as the dispatch radius): two AMR centres stay ≥ 2× apart. */
  amrClearance: 1.243,
  /** Idle service forklift steps aside (m) when a working one has been held this long (s) within `yieldRange` (m). */
  yieldAfter: 2,
  yieldRange: 6,
  yieldStep: 3.5,
  holdTimeout: 3,
  giveUp: 8,
  /** Deadlock pass window (s) after giveUp. */
  passTime: 4,
  /** Empty pallets visible on a pallet source stack (infinite supply). */
  sourceStack: 4,
  /** Pallet-unit inbound: max distance (m) from a belt end to the shuttle AMR it feeds. */
  feedReach: 2.2,
  /** Receive pose: AMR centre this far past the pallet-inbound belt end (roller transfer, same deck height). */
  feedReceiveGap: 0.95,
} as const;
