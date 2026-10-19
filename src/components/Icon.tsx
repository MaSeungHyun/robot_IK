import React from "react";
import { icons, type LucideProps } from "lucide-react";
import { cn } from "@/lib/style";

type IconProps = LucideProps & {
  icon: keyof typeof icons;
  className?: string;
};

export default function Icon({
  className,
  icon,
  ...props
}: IconProps): React.ReactNode {
  const LucideIcon = icons[icon as keyof typeof icons];

  return (
    <LucideIcon className={cn("size-5 text-current", className)} {...props} />
  );
}
