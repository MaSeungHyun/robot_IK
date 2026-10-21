import { Select as RadixSelect } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { PLAYBACK_SPEEDS } from "@/constants/playback";
import { useSimulationStore } from "@/stores/useSimulationStore";

const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((speed) => ({
  value: String(speed),
  label: `${speed.toFixed(2)}x`,
}));

/** Compact flat playback speed picker for the header, next to PLAY/STOP. */
export default function PlaybackSpeedSelect() {
  const speed = useSimulationStore((state) => state.speed);
  const setSpeed = useSimulationStore((state) => state.setSpeed);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-[#a0a4ab]">Speed</span>
      <RadixSelect.Root
        value={String(speed)}
        onValueChange={(value) => setSpeed(Number(value))}
      >
        <RadixSelect.Trigger
          aria-label="전체 속도"
          className="flex h-6 w-20 items-center justify-between gap-2 rounded-[3px] border border-[#2c2e33] bg-[#1b1c1f] px-2 text-xs tabular-nums text-text-primary outline-none hover:border-[#3a3d43] focus-visible:border-brand-primary data-[state=open]:border-brand-primary"
        >
          <RadixSelect.Value />
          <RadixSelect.Icon>
            <ChevronDown size={12} className="text-[#a0a4ab]" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[3px] border border-[#2c2e33] bg-[#1b1c1f] py-1 text-xs text-text-primary"
          >
            <RadixSelect.Viewport className="max-h-[280px]">
              {SPEED_OPTIONS.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  className="relative flex cursor-pointer select-none items-center py-1 pl-6 pr-3 tabular-nums outline-none data-[highlighted]:bg-brand-primary data-[highlighted]:text-slate-950"
                >
                  <RadixSelect.ItemIndicator className="absolute left-1.5">
                    <Check size={11} />
                  </RadixSelect.ItemIndicator>
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}
