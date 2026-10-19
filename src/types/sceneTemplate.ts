import type { ConveyorTurn, EquipmentKind, EquipmentPose, EquipmentSettings } from "@/types/layout";

export type TemplateEquipment = EquipmentPose & {
  kind: EquipmentKind;
  conveyorTurn?: ConveyorTurn;
  settings?: Partial<EquipmentSettings>;
};

export type SceneTemplate = {
  id: string;
  name: string;
  description: string;
  equipment: readonly TemplateEquipment[];
};
