import IconButton from "@/components/IconButton";
import { INSPECTOR_TABS } from "@/constants/hud";
import { useHudStore } from "@/stores/useHudStore";
import { useModeStore } from "@/stores/useModeStore";
import { useSceneStore } from "@/stores/useSceneStore";

/** Korean names for the icon-only tabs (aria-label + tooltip). */
const INSPECTOR_TAB_LABELS: Record<string, string> = { equipments: "설비 목록", details: "상세 정보", dashboard: "대시보드" };

export default function InspectorTabs() {
  const mode = useModeStore((state) => state.mode);
  const editing = useSceneStore((state) => state.editing);
  const activeTab = useHudStore((state) => state.inspectorTab);
  const toggleTab = useHudStore((state) => state.toggleInspectorTab);
  if (mode === "simulation" && editing) return null;

  return (
    <nav aria-label="정보 패널" className="ml-auto flex items-center gap-1">
      {INSPECTOR_TABS.map(({ id, label, icon }) => (
        <IconButton key={id} icon={icon} label={INSPECTOR_TAB_LABELS[id] ?? label} tooltipSide="bottom" aria-pressed={activeTab === id} active={activeTab === id} onClick={() => toggleTab(id)} />
      ))}
    </nav>
  );
}
