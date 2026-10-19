import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible } from "radix-ui";

type Props = { title: string; children: ReactNode; collapsible?: boolean };

export default function DetailSection({ title, children, collapsible = false }: Props) {
  const content = <div className="text-xs text-text-secondary">{children}</div>;

  if (collapsible) {
    return (
      <Collapsible.Root className="mt-3 border-t border-brand-primary/15 pt-2">
        <h3>
          <Collapsible.Trigger className="group flex w-full items-center justify-between rounded-sm py-1 text-left text-xs font-medium text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
            {title}
            <ChevronDown size={12} className="text-text-secondary transition-transform group-data-[state=open]:rotate-180" />
          </Collapsible.Trigger>
        </h3>
        <Collapsible.Content className="mt-2 space-y-3 text-xs text-text-secondary">{children}</Collapsible.Content>
      </Collapsible.Root>
    );
  }

  return (
    <section className="mt-3 border-t border-brand-primary/15 pt-2" aria-label={title}>
      <h3 className="mb-1 text-xs font-medium text-text-primary">{title}</h3>
      {content}
    </section>
  );
}
