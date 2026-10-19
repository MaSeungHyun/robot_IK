import Button from "@/components/Button";
import Icon from "@/components/Icon";
import type { icons } from "lucide-react";
import { cn } from "@/lib/style";
import { useModeStore } from "@/stores/useModeStore";

type Mode = "simulation" | "monitoring";

const MODES: {
  mode: Mode;
  icon: keyof typeof icons;
  label: string;
  className: string;
}[] = [
  {
    mode: "simulation",
    icon: "Box",
    label: "SIMULATION",
    className: "rounded-none rounded-l-md text-text-secondary",
  },
  {
    mode: "monitoring",
    icon: "Activity",
    label: "MONITORING",
    className: "rounded-none rounded-r-md text-text-secondary",
  },
];

export default function ModeSelect() {
  const activeMode = useModeStore((state) => state.mode);
  const setMode = useModeStore((state) => state.setMode);

  return (
    <div className="flex items-center max-lg:justify-end">
      {MODES.map(({ mode, icon, label, className }) => (
        <Button
          key={mode}
          className={cn(className, activeMode === mode && "text-text-primary")}
          active={activeMode === mode}
          onClick={() => setMode(mode)}
        >
          <Icon
            icon={icon}
            aria-hidden="true"
            className={cn(
              "size-4",
              activeMode === mode
                ? "text-brand-primary"
                : "text-text-secondary",
            )}
          />
          {label}
        </Button>
      ))}
    </div>
  );
}
