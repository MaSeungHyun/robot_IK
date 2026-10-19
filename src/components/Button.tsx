import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/style";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  fill?: boolean;
  active?: boolean;
};
export default function Button({
  fill = false,
  active = false,
  className = "",

  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "flex h-8 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-40 text-text-secondary",
        fill
          ? "bg-brand-primary text-slate-950 hover:bg-brand-primary/80"
          : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
        active &&
          "text-text-primary stroke-brand-primary border-brand-primary/80 bg-radial from-bg-primary via-brand-primary/15 via-80% to-brand-primary/10 to-150%",
        className,
      )}
    />
  );
}
