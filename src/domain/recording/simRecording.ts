/**
 * Simulation recording (schema v1). Additive: every field is new; nothing existing changes shape.
 * Fields added after the first v1 cut (pallet yaw/carrier, palletParents) are appended / optional, so older v1 readers still work.
 * Times are simulation seconds (3 decimals), positions metres in world (or parent-local where noted), quaternions [x, y, z, w].
 * See docs/sim-recording.md.
 */
export const SIM_RECORDING_VERSION = 1;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** [t, robotId, on (true = ATTACH, false = RELEASE), boxId] */
export type SuctionEvent = [t: number, robotId: string, on: boolean, boxId: string | null];

/** Tool-tip (grip) vs box at an ATTACH: world tool point, box top-face centre, their distance and vertical gap (tool - top). */
export type SuctionContact = { t: number; robotId: string; boxId: string | null; tool: Vec3; boxTop: Vec3; distance: number; dy: number };

/** Where a box sits. "rack"/"dock"/"world"/"none" extend the requested set; "none" = removed from the scene. */
export type BoxParentKind = "conveyor" | "pallet" | "arm" | "amr" | "rail" | "rack" | "dock" | "world" | "none";

/** [t, boxId, parentKind, parentId, local position, local quaternion] (local to the box's three.js parent).
 *  parentKind "pallet" always carries the pallet id (events are deferred until it is known). */
export type BoxParentEvent = [t: number, boxId: string, kind: BoxParentKind, parentId: string | null, position: Vec3, quaternion: Quat];

/** 1 Hz world-position sample of every box in the scene: [boxId, x, y, z]. */
export type BoxKeyframe = { t: number; boxes: [boxId: string, x: number, y: number, z: number][] };

/** What carries a pallet group: amr (AMR / forklift / AGV carrier), rail (rail or transfer), arm, station, rack, dock, conveyor, world. */
export type PalletCarrierKind = "amr" | "rail" | "arm" | "station" | "rack" | "dock" | "conveyor" | "world";

/** create = new pallet record; move = state or carrier changed (detail = new state, or "kind:id"), and 1 Hz while on amr/rail;
 *  ship = shipped or retired. */
export type PalletEventKind = "create" | "move" | "ship";
/** [t, palletId, kind, detail, world position, world yaw (rad), carrierKind, carrierId]. Position/yaw are the last known pose
 *  (null only if the pallet group was never seen); carrier is null when it sits directly on the world root. */
export type PalletEvent = [t: number, palletId: string, kind: PalletEventKind, detail: string | null, position: Vec3 | null,
  yaw?: number | null, carrierKind?: PalletCarrierKind | null, carrierId?: string | null];

/** [t, palletId, carrierKind, carrierId] each time the pallet group's carrier changes. */
export type PalletParentEvent = [t: number, palletId: string, kind: PalletCarrierKind, carrierId: string | null];

export type SimRecording = {
  version: typeof SIM_RECORDING_VERSION;
  template: string;
  seed: number;
  seconds: number;
  suction: SuctionEvent[];
  contacts: SuctionContact[];
  boxParents: BoxParentEvent[];
  boxKeyframes: BoxKeyframe[];
  pallets: PalletEvent[];
  palletParents?: PalletParentEvent[];
};
