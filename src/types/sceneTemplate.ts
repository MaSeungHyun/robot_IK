import type { TemplateLink } from "@/types/links";
import type { ConveyorTurn, EquipmentKind, EquipmentPose, EquipmentSettings, FloorSize } from "@/types/layout";

export type TemplateEquipment = EquipmentPose & {
  kind: EquipmentKind;
  conveyorTurn?: ConveyorTurn;
  floor?: FloorSize;
  settings?: Partial<EquipmentSettings>;
};

export type SceneTemplate = {
  id: string;
  name: string;
  description: string;
  equipment: readonly TemplateEquipment[];
  /** Optional equipment relations (🔗) by equipment index; templates without links keep distance-based behaviour. */
  links?: readonly TemplateLink[];
};
