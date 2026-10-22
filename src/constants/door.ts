/** Industrial roller-shutter door (m, s). Width/height are per-door settings; limits are sanity only. */
export const DOOR_CONFIG = {
  width: 4,
  height: 4.5,
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