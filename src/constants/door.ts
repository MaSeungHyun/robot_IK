/** Industrial roller-shutter door (m, s). Width/height are per-door settings; limits are sanity only. */
export const DOOR_CONFIG = {
  /** Defaults = door.glb panel native size (wall_door.001: 6.9321 x 6.0 m); with door.glb present the panel's own size is used. */
  width: 6.9321,
  height: 6,
  /** Fraction of the height a fully opened door rolls up (1 = completely open). */
  openRatio: 1 / 2,
  minSize: 0.6,
  maxWidth: 30,
  maxHeight: 15,
  /** A door moved within this distance of a wall plane snaps flush and turns to face along it. */
  snapDistance: 0.5,
  /** A door this close to a wall plane cuts its opening into that wall. */
  wallTolerance: 0.3,
  /** Full roll-up / roll-down time. */
  travelSeconds: 1.5,
  jamb: 0.15,
  frameDepth: 0.3,
  boxHeight: 0.6,
  boxDepth: 0.5,
  /** Slat pitch of the shutter curtain. */
  slat: 0.1,
} as const;