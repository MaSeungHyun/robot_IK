import type { TemplateLink } from "@/types/links";
import type { ConveyorPathId } from "@/domain/conveyor/conveyorPaths";
import type { ConveyorTurn, EquipmentKind, EquipmentPose, EquipmentSettings, FloorSize } from "@/types/layout";

export type TemplateEquipment = EquipmentPose & {
  kind: EquipmentKind;
  conveyorTurn?: ConveyorTurn;
  /** Spline conveyor drawn with its whole glb rail (see conveyorPaths). */
  conveyorPath?: ConveyorPathId;
  /** Straight belt length in metres (default 26.25 = rail.glb). */
  conveyorLength?: number;
  /** Mount height (m), e.g. a robot standing on a GLB pedestal. */
  elevation?: number;
  floor?: FloorSize;
  settings?: Partial<EquipmentSettings>;
};

/** Static decor: a named root node of a template source GLB, drawn at its authored transform (not simulated, not editable). */
export type TemplateProp = {
  source: "factory" | "railInOut" | "agv" | "robotBase" | "robotArmPlace";
  node: string;
  /** World position override (default: the node's authored transform); yaw in radians about +Y. */
  position?: readonly [number, number, number];
  yaw?: number;
  /** Skip meshes whose material name is listed (parts drawn by the room kit instead, e.g. Enviroment "wall"/"BG_Floor"). */
  excludeMaterials?: readonly string[];
};

/** Camera pose: eye position + orbit target (world m). */
export type TemplateCameraPose = { position: [number, number, number]; target: [number, number, number] };
/**
 * Shipped camera defaults: start view and play-mode bookmarks (slot 0 = key 1 .. slot 9 = key 0, null = empty).
 * Used when this browser has no saved view / bookmarks for the template's scope; localStorage wins when present.
 */
export type TemplateCamera = { view?: TemplateCameraPose; bookmarks?: readonly (TemplateCameraPose | null)[] };

/** Template lighting preset; "factory" = factory.glb lights + HDR + AgX (see viewport/lighting/FactoryLighting.tsx). */
export type TemplateLighting = "factory";

export type SceneTemplate = {
  id: string;
  name: string;
  description: string;
  equipment: readonly TemplateEquipment[];
  /** Optional equipment relations (🔗) by equipment index; templates without links keep distance-based behaviour. */
  links?: readonly TemplateLink[];
  /** Optional GLB props (static decor kept as authored; see objects/props/GlbProps.tsx). */
  props?: readonly TemplateProp[];
  /** Optional lighting preset replacing the default ambient + key light. */
  lighting?: TemplateLighting;
  /** Global "자동 연결" (default true): relations without a 🔗 link pick the nearest target; false = they wait with a warning. */
  autoConnect?: boolean;
  /** Optional default camera view + bookmarks (see TemplateCamera). */
  camera?: TemplateCamera;
};
