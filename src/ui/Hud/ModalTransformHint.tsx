import { useModalTransformStore } from "@/stores/useModalTransformStore";

/** Small status hint while a G/R modal transform is active. */
export default function ModalTransformHint() {
  const mode = useModalTransformStore((state) => state.session?.mode);
  if (!mode) return null;
  return (
    <p
      role="status"
      className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-brand-primary/30 bg-bg-primary/95 px-3 py-1.5 text-xs text-text-primary shadow-xl backdrop-blur-md"
    >
      <span className="font-semibold text-brand-primary">{mode === "move" ? "G: 이동" : "R: 회전"}</span>
      {" — 클릭 확정 / Esc·우클릭 취소 · Shift: 스냅 해제"}
    </p>
  );
}
