import { Select as RadixSelect } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

type Props<T extends string> = {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: T) => void;
  /** Trigger width class. Defaults to full width. */
  widthClassName?: string;
};

/** Flat compact select shared across the app (playback speed style). */
export default function Select<T extends string>({
  label,
  value,
  options,
  onValueChange,
  widthClassName = "w-full",
}: Props<T>) {
  const current = options.find((option) => option.value === value)?.label;
  return (
    <RadixSelect.Root
      value={value}
      onValueChange={(value) => {
        const option = options.find((option) => option.value === value);
        if (option) onValueChange(option.value);
      }}
    >
      <RadixSelect.Trigger
        aria-label={label}
        title={current}
        className={`flex h-6 ${widthClassName} items-center justify-between gap-2 rounded-[3px] border border-[#2c2e33] bg-[#1b1c1f] px-2 text-xs tabular-nums text-text-primary outline-none hover:border-[#3a3d43] focus-visible:border-brand-primary data-[state=open]:border-brand-primary`}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          <RadixSelect.Value />
        </span>
        <RadixSelect.Icon className="shrink-0">
          <ChevronDown size={12} className="text-[#a0a4ab]" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-1000 min-w-[var(--radix-select-trigger-width)] max-w-[min(320px,90vw)] overflow-hidden rounded-[3px] border  bg-bg-primary/90 py-1 text-xs text-text-primary border-brand-primary/20"
        >
          <RadixSelect.ScrollUpButton className="flex justify-center py-0.5 text-[#a0a4ab]">
            <ChevronUp size={12} />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="max-h-[280px]">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                title={option.label}
                className="relative flex cursor-pointer select-none items-center py-1 pl-6 pr-3 tabular-nums outline-none data-[highlighted]:bg-brand-primary data-[highlighted]:text-slate-950"
              >
                <RadixSelect.ItemIndicator className="absolute left-1.5">
                  <Check size={11} />
                </RadixSelect.ItemIndicator>
                <span className="min-w-0 truncate">
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                </span>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex justify-center py-0.5 text-[#a0a4ab]">
            <ChevronDown size={12} />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
