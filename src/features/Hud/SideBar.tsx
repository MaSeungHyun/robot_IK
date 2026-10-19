import { WORKSPACE_MODES } from "@/constants/hud";
import Box from "@/components/Box";
import Icon from "@/components/Icon";
import { useHudStore } from "@/stores/useHudStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { cn } from "@/lib/style";

export default function SideBar() {
  const editing = useSceneStore((state) => state.editing);
  const panelOpen = useHudStore((state) => state.workspacePanelOpen);
  const selectMode = useHudStore((state) => state.selectWorkspaceMode);
  const activeMode = editing ? "edit" : "play";

  return (
    <nav aria-label="시뮬레이션 작업 모드" className="pointer-events-auto flex h-full w-12 shrink-0 flex-col items-center gap-2 border-r border-brand-primary/20 bg-bg-primary/85 py-2">
      {WORKSPACE_MODES.map(({ id, label, icon }) => (
        <Box
          key={id}
          aria-label={label}
          aria-pressed={activeMode === id}
          aria-expanded={activeMode === id && panelOpen}
          title={label}
          active={activeMode === id}
          className={cn("size-10 shrink-0 px-0 focus-visible:ring-2 focus-visible:ring-brand-primary", activeMode === id && "bg-brand-primary/10 text-brand-primary")}
          onClick={() => selectMode(id)}
        >
          <Icon icon={icon} aria-hidden="true" />
        </Box>
      ))}
    </nav>
  );
}
