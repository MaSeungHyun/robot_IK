import Icon from "@/components/Icon";
import SideTooltip from "@/components/SideTooltip";
import { cn } from "@/lib/style";
import { useSceneStore, type EditorTool } from "@/stores/useSceneStore";
import { useLinkModeStore } from "@/stores/useLinkModeStore";

/** Same treatment as the header playback buttons (PlaybackControls). */
const ACCENT =
  "bg-brand-primary/20 text-brand-primary hover:bg-brand-primary/30";
const IDLE =
  "bg-white/[.06] text-text-primary/80 hover:bg-white/[.11] hover:text-text-primary";
const TOOL_BUTTON =
  "group/tip relative flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-1 focus-visible:ring-brand-primary";

const TOOLS: {
  tool: EditorTool;
  icon: "MousePointer2" | "Move" | "RotateCw";
  label: string;
  key: string;
}[] = [
  { tool: "select", icon: "MousePointer2", label: "선택", key: "W" },
  { tool: "translate", icon: "Move", label: "이동", key: "G" },
  { tool: "rotate", icon: "RotateCw", label: "회전", key: "R" },
];

/** Blender-style vertical tool strip at the viewport's left edge (edit mode only). */
export default function EditorToolbar() {
  const tool = useSceneStore((state) => state.tool);
  const setTool = useSceneStore((state) => state.setTool);
  const linking = useLinkModeStore((state) => state.active);
  const setLinking = useLinkModeStore((state) => state.setActive);

  return (
    <div
      role="toolbar"
      aria-label="편집 도구"
      aria-orientation="vertical"
      className="flex simulation-panel absolute bottom-3 left-1/2 -translate-x-1/2 z-200 flex gap-1 rounded-md border border-white/10 bg-bg-primary/85 p-1 backdrop-blur-sm"
    >
      {TOOLS.map((entry) => {
        const active = !linking && tool === entry.tool;
        return (
          <button
            key={entry.tool}
            type="button"
            aria-label={entry.label}
            aria-pressed={active}
            className={cn(TOOL_BUTTON, active ? ACCENT : IDLE)}
            onClick={() => {
              setLinking(false);
              setTool(entry.tool);
            }}
          >
            <Icon icon={entry.icon} aria-hidden="true" className="size-3.5" />
            <SideTooltip
              label={`${entry.label} (${entry.key})${entry.tool === "select" ? " · 선택 항목 보기 (F)" : ""}`}
            />
          </button>
        );
      })}
      <span aria-hidden className="mx-1 my-0.5 h-px bg-white/10" />
      <button
        type="button"
        aria-label="연결"
        aria-pressed={linking}
        className={cn(TOOL_BUTTON, linking ? ACCENT : IDLE)}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          // Read the store, not the render closure, so a fast second press always turns it off.
          useLinkModeStore.getState().toggle();
          event.currentTarget.blur();
        }}
      >
        <Icon icon="Link" aria-hidden="true" className="size-3.5" />
        <SideTooltip label="연결 (L) · 설비를 차례로 클릭해 연결, 다시 연결하면 해제" />
      </button>
    </div>
  );
}
