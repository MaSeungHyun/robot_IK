import { RACK_MODEL } from "@/constants/modelPoints.generated";

/** Deepest roof girder (RoomRoof lattice depth cap, m); the truss hangs this far below the wall top. */
const GIRDER_DEPTH = 1.1;
/** Free space kept between the tallest rack (Rack.glb top) and the underside of the roof trusses (m). */
const RACK_OVERHEAD = 0.5;
/** Wall heights snap to this step (FLOOR_CONFIG.wallStep). */
const WALL_STEP = 0.5;

export const FACTORY_ROOM = {
  girderDepth: GIRDER_DEPTH,
  /**
   * Default room wall height: tallest rack + truss depth (+ deck) + overhead, rounded up to the wall step
   * (Rack.glb 7.55 m -> 9.5 m). Used by templates and as the starting height when drawing a floor.
   */
  defaultWallHeight: Math.ceil((RACK_MODEL.max[1] + GIRDER_DEPTH + 0.06 + RACK_OVERHEAD) / WALL_STEP) * WALL_STEP,
  baySpacing: 4,
  trussSpacing: 4,
  panelWidth: 1.2,
  textureSize: 256,
  floorTileSize: 4,
  steelColor: "#c8d0d4",
  floorColor: "#bdc5c8",
  wallColor: "#d6dbdc",
  baseColor: "#657f88",
  ceilingColor: "#899397",
} as const;
