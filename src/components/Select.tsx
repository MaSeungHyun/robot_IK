import { Select as RadixSelect } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

type Props<T extends string> = {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: T) => void;
};

export default function Select<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: Props<T>) {
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
        className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-slate-100 outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400 data-[state=open]:border-sky-400/60"
      >
        <RadixSelect.Value />
        <RadixSelect.Icon>
          <ChevronDown size={16} className="text-slate-400" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={7}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-white/10 bg-slate-900 p-1.5 text-sm text-slate-100 shadow-2xl"
        >
          <RadixSelect.ScrollUpButton className="flex justify-center py-1 text-slate-400">
            <ChevronUp size={14} />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="max-h-[280px]">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className="relative flex cursor-pointer select-none items-center rounded-md py-2.5 pl-9 pr-4 outline-none data-[highlighted]:bg-sky-400/15 data-[highlighted]:text-sky-200"
              >
                <RadixSelect.ItemIndicator className="absolute left-3">
                  <Check size={14} />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex justify-center py-1 text-slate-400">
            <ChevronDown size={14} />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
