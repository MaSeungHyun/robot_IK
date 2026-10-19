import type { ComponentType } from "react";
import EquipmentStatusPanel from "@/features/Hud/equipment/EquipmentStatusPanel";
import EquipmentDetailsPanel from "@/features/Hud/equipment/EquipmentDetailsPanel";
import DashboardMenuPanel from "@/features/Hud/dashboard/DashboardMenuPanel";
import { useHudStore } from "@/stores/useHudStore";
import type { InspectorTab } from "@/types/hud";

const INSPECTOR_PANELS = {
  equipments: EquipmentStatusPanel,
  details: EquipmentDetailsPanel,
  dashboard: DashboardMenuPanel,
} satisfies Record<InspectorTab, ComponentType>;

export default function InspectorPanel() {
  const tab = useHudStore((state) => state.inspectorTab);
  if (!tab) return null;
  const ActivePanel = INSPECTOR_PANELS[tab];
  return <ActivePanel />;
}
