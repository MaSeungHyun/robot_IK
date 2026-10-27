import { Info } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { INFO_TIP_LIST } from "@/constants/hud";

const WIDTH = 240;
const GAP = 6;
const MARGIN = 8;

/** Renders a string with \n as one block per line (option lists); other nodes pass through unchanged. */
export function InfoText({ text }: { text: React.ReactNode }) {
  if (typeof text !== "string" || !text.includes("\n")) return <>{text}</>;
  return (
    <span className="flex flex-col" style={{ gap: INFO_TIP_LIST.itemGap, lineHeight: INFO_TIP_LIST.lineHeight }}>
      {text.split("\n").map((line, index) => <span key={index} className="block">{line}</span>)}
    </span>
  );
}

/**
 * (i) icon next to an option label: muted, white on hover/focus; the explanation shows in a floating card on
 * hover or keyboard focus (Tab), linked via aria-describedby. The card is portalled to document.body with fixed
 * positioning (never clipped by scrolling panels / overflow-hidden rows), flips above when there is no room below
 * and shifts horizontally to stay inside the viewport. Real warnings stay inline, not in here.
 */
/** Card heading: explicit `title`, else the aria label minus its trailing suffix (labels are "<name> SUFFIX"). */
export default function InfoTip({ text, label = "설명", title }: { text: React.ReactNode; label?: string; title?: React.ReactNode }) {
  const heading = title ?? (label.endsWith(" 설명") ? label.slice(0, -" 설명".length) : undefined);
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const c = card.current?.getBoundingClientRect();
      if (!a) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const width = Math.min(WIDTH, vw - MARGIN * 2), height = c?.height ?? 0;
      const left = Math.min(Math.max(a.left + a.width / 2 - width / 2, MARGIN), vw - width - MARGIN);
      const below = a.bottom + GAP;
      const top = below + height > vh - MARGIN && a.top - GAP - height >= MARGIN ? a.top - GAP - height : Math.max(MARGIN, Math.min(below, vh - height - MARGIN));
      setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    };
    place();
    const frame = requestAnimationFrame(place); // second pass once the card has its measured height
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const show = () => setOpen(true);
  const hide = () => { setOpen(false); setPos(null); };

  return (
    <span className="ml-1 inline-flex align-middle" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex size-4 items-center justify-center rounded-full text-text-secondary/70 outline-none transition-colors hover:text-text-primary focus-visible:text-text-primary focus-visible:ring-1 focus-visible:ring-white/40"
        onClick={(event) => event.preventDefault()}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(event) => { if (event.key === "Escape") hide(); }}
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {createPortal(
        <span
          ref={card}
          id={id}
          role="tooltip"
          style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: Math.min(WIDTH, typeof window === "undefined" ? WIDTH : window.innerWidth - MARGIN * 2), zIndex: 10000 }}
          className={`pointer-events-none block rounded-md border border-white/10 bg-bg-primary px-2.5 py-2 text-left text-[11px] leading-4 font-normal whitespace-normal text-text-primary transition-opacity ${open && pos ? "visible opacity-100" : "invisible opacity-0"}`}
        >
          {heading && <span className="mb-1 block font-semibold text-brand-primary">{heading}</span>}
          <InfoText text={text} />
        </span>,
        document.body,
      )}
    </span>
  );
}