import type { ReactNode } from "react";
import { Tabs as RadixTabs } from "radix-ui";

type Props<T extends string> = {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  items: readonly { value: T; label: string; content: ReactNode }[];
};

export default function Tabs<T extends string>({ label, value, onValueChange, items }: Props<T>) {
  return (
    <RadixTabs.Root value={value} onValueChange={(next) => {
      const item = items.find((item) => item.value === next);
      if (item) onValueChange(item.value);
    }} className="flex min-h-0 flex-1 flex-col">
      <RadixTabs.List aria-label={label} className="mb-4 flex shrink-0 gap-1 rounded-lg bg-white/5 p-1">
        {items.map((item) => (
          <RadixTabs.Trigger key={item.value} value={item.value} className="flex-1 rounded-md px-3 py-2 text-xs text-text-secondary outline-none transition focus-visible:ring-2 focus-visible:ring-brand-primary data-[state=active]:bg-brand-primary/15 data-[state=active]:text-brand-primary">
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-brand-primary data-[state=active]:flex data-[state=active]:flex-col">
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
