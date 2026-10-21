import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import type { icons } from "lucide-react";
import Icon from "@/components/Icon";
import { cn } from "@/lib/style";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  icon: keyof typeof icons;
  /** Accessible name and visible hover/focus tooltip text. */
  label: string;
  tooltipSide?: "top" | "bottom";
  /** Pressed / selected look (brand-primary icon). */
  active?: boolean;
  iconClassName?: string;
};

/**
 * Ghost icon-only button (no box) with an aria-label and a CSS tooltip on hover / keyboard focus.
 * The button is the root element and forwards its ref, so it works as a Radix `asChild` trigger.
 */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, tooltipSide = "bottom", active = false, className, iconClassName, type = "button", ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        "group/icon-button relative inline-flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-text-secondary outline-none transition-colors hover:bg-white/[.06] hover:text-brand-primary focus-visible:bg-white/[.06] focus-visible:text-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary/60 disabled:opacity-40",
        // No lighter surface token exists (bg-secondary #0b202d is darker), so hover uses white at 6% over bg-primary.
        active && "bg-white/[.06] text-brand-primary",
        className,
      )}
    >
      <Icon icon={icon} className={cn("size-4", iconClassName)} aria-hidden />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-1/2 z-300 -translate-x-1/2 whitespace-nowrap rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-normal text-white opacity-0 shadow transition-opacity group-hover/icon-button:opacity-100 group-focus-visible/icon-button:opacity-100",
          tooltipSide === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
        )}
      >
        {label}
      </span>
    </button>
  );
});

export default IconButton;
