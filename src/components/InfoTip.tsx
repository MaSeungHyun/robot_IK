import { Info } from "lucide-react";
import { useId } from "react";

/**
 * (i) icon next to an option label: muted, #02dfef on hover/focus; the explanation shows in a floating card on
 * hover or keyboard focus (Tab), linked via aria-describedby. Real warnings stay inline, not in here.
 */
export default function InfoTip({ text, label = "설명" }: { text: React.ReactNode; label?: string }) {
  const id = useId();
  return (
    <span className="group/info relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex size-4 items-center justify-center rounded-full text-text-secondary/70 outline-none transition-colors hover:text-[#02dfef] focus-visible:text-[#02dfef] focus-visible:ring-1 focus-visible:ring-[#02dfef]"
        onClick={(event) => event.preventDefault()}
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute top-full left-1/2 z-300 mt-1.5 w-60 -translate-x-1/2 rounded-md border border-white/10 bg-bg-primary/95 px-2.5 py-2 text-[11px] leading-4 font-normal text-text-primary opacity-0 shadow-2xl backdrop-blur-md transition-opacity group-hover/info:visible group-hover/info:opacity-100 group-focus-within/info:visible group-focus-within/info:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
