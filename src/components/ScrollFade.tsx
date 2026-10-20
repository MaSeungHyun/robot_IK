import { useCallback, useEffect, useRef, type ComponentProps, type CSSProperties } from "react";
import { cn } from "@/lib/style";

type Props = ComponentProps<"div"> & {
  /** Maximum fade height in px. */
  fade?: number;
};

// Eased stops (transparent -> opaque) as fractions of the fade height.
const STOPS: [number, number][] = [[0, 0], [0.15, 0.1], [0.4, 0.4], [0.7, 0.8], [1, 1]];
const edge = (size: string, fromEnd: boolean) =>
  STOPS.map(([at, alpha]) => {
    const offset = `calc(${size} * ${at})`;
    return `rgba(0,0,0,${alpha}) ${fromEnd ? `calc(100% - ${offset})` : offset}`;
  });
const MASK = `linear-gradient(to bottom, ${[...edge("var(--fade-top)", false), ...edge("var(--fade-bottom)", true).reverse()].join(", ")})`;

/**
 * Vertical scroll container with soft, eased top/bottom fades (mask-image).
 * Each fade grows with the hidden distance on that side (min(distance, fade)),
 * and the registered --fade-* properties (index.css) transition smoothly.
 * Lay it out with `min-h-0` plus a flex size (e.g. `flex-auto`) inside a bounded flex column.
 */
export default function ScrollFade({ fade = 36, className, style, children, onScroll, ...props }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const below = element.scrollHeight - element.clientHeight - element.scrollTop;
    element.style.setProperty("--fade-top", `${Math.max(0, Math.min(element.scrollTop, fade))}px`);
    element.style.setProperty("--fade-bottom", `${Math.max(0, Math.min(below, fade))}px`);
  }, [fade]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observe = () => {
      resize.disconnect();
      resize.observe(element);
      for (const child of Array.from(element.children)) resize.observe(child);
    };
    const resize = new ResizeObserver(measure);
    const mutations = new MutationObserver(() => {
      observe();
      measure();
    });
    observe();
    mutations.observe(element, { childList: true });
    measure();
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [measure]);

  return (
    <div
      {...props}
      ref={ref}
      onScroll={(event) => {
        measure();
        onScroll?.(event);
      }}
      className={cn(
        "overflow-y-auto [scrollbar-color:#334155_transparent] [scrollbar-width:thin] [transition:--fade-top_.25s_ease-out,--fade-bottom_.25s_ease-out]",
        className,
      )}
      style={{ ...style, maskImage: MASK, WebkitMaskImage: MASK } as CSSProperties}
    >
      {children}
    </div>
  );
}
