import React from "react";
import { cn } from "@/lib/style";

type BoxProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  className?: string;
  children: React.ReactNode;
  active?: boolean;
};
export default function Box({
  className,
  children,
  active,
  ...props
}: BoxProps) {
  return (
    <button
      type="button"
      className={cn(
        "w-10 h-10 bg-bg-primary/10 rounded-md flex items-center justify-center hover:bg-brand-primary/10 transition-colors outline-none",
        active && "bg-brand-primary/0 text-brand-primary",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
