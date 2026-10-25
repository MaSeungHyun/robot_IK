import { useSceneStore } from "@/stores/useSceneStore";
import { useWalkModeStore } from "@/stores/useWalkModeStore";
import { cn } from "@/lib/style";

/** VR headset glyph (lucide has none); `filled` fills the visor in the current colour. */
function VrHeadsetIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path
        d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3.5l-2-2.5a1.9 1.9 0 0 0-3 0l-2 2.5H5a2 2 0 0 1-2-2Z"
        fill={filled ? "currentColor" : "none"}
      />
      <path d="M1 11v2M23 11v2" />
    </svg>
  );
}

/**
 * Header top-right toggle (the HUD header covers the viewport top, so it lives there) for first-person walk mode, shown during play only. Same ghost look as IconButton;
 * active = brand #02dfef at 20% behind a filled brand icon.
 */
export default function WalkModeButton() {
  const editing = useSceneStore((state) => state.editing);
  const active = useWalkModeStore((state) => state.active);
  if (editing) return null;
  const label = active ? "워크 모드 종료 (Esc)" : "워크 모드 (WASD 이동 · Shift 달리기 · 마우스 시점)";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={() => useWalkModeStore.getState().toggle()}
      className={cn(
        "group/icon-button relative inline-flex shrink-0 size-7 items-center justify-center rounded-md border-0 bg-transparent text-text-secondary outline-none transition-colors hover:bg-white/[.06] hover:text-brand-primary focus-visible:bg-white/[.06] focus-visible:text-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary/60",
        active && "bg-[#02dfef]/20 text-[#02dfef] hover:bg-[#02dfef]/20 hover:text-[#02dfef]",
      )}
    >
      <VrHeadsetIcon filled={active} className="size-4" />
      <span
        aria-hidden
        className="pointer-events-none absolute right-0 top-full z-300 mt-1 whitespace-nowrap rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-normal text-white opacity-0 shadow transition-opacity group-hover/icon-button:opacity-100 group-focus-visible/icon-button:opacity-100"
      >
        {label}
      </span>
    </button>
  );
}
