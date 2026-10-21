import Button from "@/components/Button";
import Icon from "@/components/Icon";
import { INSPECTOR_TABS } from "@/constants/hud";
import { useHudStore } from "@/stores/useHudStore";
import { useModeStore } from "@/stores/useModeStore";
import { useSceneStore } from "@/stores/useSceneStore";

export default function InspectorTabs() {
  const mode = useModeStore((state) => state.mode);
  const editing = useSceneStore((state) => state.editing);
  const activeTab = useHudStore((state) => state.inspectorTab);
  const toggleTab = useHudStore((state) => state.toggleInspectorTab);
  if (mode === "simulation" && editing) return null;

  return (
    <nav aria-label="정보 패널" className="ml-auto flex items-center gap-1">
      {INSPECTOR_TABS.map(({ id, label, icon }) => (
        <Button key={id} aria-label={label} aria-pressed={activeTab === id} active={activeTab === id} onClick={() => toggleTab(id)} className="h-8 px-2 text-xs">
          <Icon icon={icon} aria-hidden="true" className="size-3.5" />
          {label}
        </Button>
      ))}
    </nav>
  );
}
