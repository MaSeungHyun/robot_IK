import Icon from "@/components/Icon";
import { cn } from "@/lib/style";
import { useSceneStore, type EditorTool } from "@/stores/useSceneStore";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import { useAutoLayoutStore } from "@/stores/useAutoLayoutStore";

/** Same treatment as the header playback buttons (PlaybackControls). */
const ACCENT = "bg-brand-primary/20 text-brand-primary hover:bg-brand-primary/30";
const IDLE = "bg-white/[.06] text-text-primary/80 hover:bg-white/[.11] hover:text-text-primary";
const TOOL_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-1 focus-visible:ring-brand-primary";

const TOOLS: { tool: EditorTool; icon: "MousePointer2" | "Move" | "RotateCw"; label: string; key: string }[] = [
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
  const autoOpen = useAutoLayoutStore((state) => state.open);

  return (
    <div
      role="toolbar"
      aria-label="편집 도구"
      aria-orientation="vertical"
      className="simulation-panel absolute top-3 left-3 z-200 flex flex-col gap-1 rounded-md border border-white/10 bg-bg-primary/85 p-1 backdrop-blur-sm"
    >
      {TOOLS.map((entry) => {
        const active = !linking && tool === entry.tool;
        return (
          <button
            key={entry.tool}
            type="button"
            aria-label={entry.label}
            aria-pressed={active}
            title={`${entry.label} (${entry.key})${entry.tool === "select" ? " · 선택 항목 보기 (F)" : ""}`}
            className={cn(TOOL_BUTTON, active ? ACCENT : IDLE)}
            onClick={() => {
              setLinking(false);
              setTool(entry.tool);
            }}
          >
            <Icon icon={entry.icon} aria-hidden="true" className="size-3.5" />
          </button>
        );
      })}
      <span aria-hidden className="mx-1 my-0.5 h-px bg-white/10" />
      <button
        type="button"
        aria-label="연결"
        aria-pressed={linking}
        title="연결 (L) · 설비를 차례로 클릭해 연결, 다시 연결하면 해제"
        className={cn(TOOL_BUTTON, linking ? ACCENT : IDLE)}
        onClick={() => setLinking(!linking)}
      >
        <Icon icon="Link" aria-hidden="true" className="size-3.5" />
      </button>
      <span aria-hidden className="mx-1 my-0.5 h-px bg-white/10" />
      <button
        type="button"
        aria-label="자동 설계"
        aria-pressed={autoOpen}
        title="자동 설계 · 공장 크기와 목표 처리량으로 배치 생성"
        className={cn(TOOL_BUTTON, autoOpen ? ACCENT : IDLE)}
        onClick={() => useAutoLayoutStore.getState().setOpen(!autoOpen)}
      >
        <Icon icon="WandSparkles" aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}