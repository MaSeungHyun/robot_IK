import IconButton from "@/components/IconButton";
import { INSPECTOR_TABS } from "@/constants/hud";
import { useHudStore } from "@/stores/useHudStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { useDashboardStore } from "@/stores/useDashboardStore";

/** Korean names for the icon-only tabs (aria-label + tooltip). */
const INSPECTOR_TAB_LABELS: Record<string, string> = { equipments: "설비 목록", details: "상세 정보", dashboard: "대시보드" };

export default function InspectorTabs() {
  const editing = useSceneStore((state) => state.editing);
  const activeTab = useHudStore((state) => state.inspectorTab);
  const toggleTab = useHudStore((state) => state.toggleInspectorTab);
  const dashboardOpen = useDashboardStore((state) => state.open);
  const setDashboardOpen = useDashboardStore((state) => state.setOpen);
  if (editing) return null;

  return (
    <nav aria-label="정보 패널" className="ml-auto flex items-center gap-1">
      {INSPECTOR_TABS.map(({ id, label, icon }) => (
        <IconButton key={id} icon={icon} label={INSPECTOR_TAB_LABELS[id] ?? label} tooltipSide="bottom" aria-pressed={id === "dashboard" ? dashboardOpen : activeTab === id} active={id === "dashboard" ? dashboardOpen : activeTab === id}
          // The dashboard tab opens the full dashboard dialog instead of the side panel.
          onClick={() => (id === "dashboard" ? setDashboardOpen(!dashboardOpen) : toggleTab(id))} />
      ))}
    </nav>
  );
}
