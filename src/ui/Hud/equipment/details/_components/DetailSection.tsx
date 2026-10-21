import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible } from "radix-ui";

type Props = { title: string; children: ReactNode; collapsible?: boolean };

const SECTION = "mt-2 rounded-[3px] border border-white/10 px-2.5 py-2";
const TITLE = "mb-1.5 text-xs font-semibold text-text-primary";

export default function DetailSection({ title, children, collapsible = false }: Props) {
  if (collapsible) {
    return (
      <Collapsible.Root className={SECTION}>
        <h3>
          <Collapsible.Trigger className="group flex w-full items-center justify-between text-left text-xs font-semibold text-text-primary outline-none focus-visible:ring-1 focus-visible:ring-brand-primary">
            {title}
            <ChevronDown size={12} className="text-text-secondary transition-transform group-data-[state=open]:rotate-180" />
          </Collapsible.Trigger>
        </h3>
        <Collapsible.Content className="mt-1.5 space-y-2 text-[11px] text-text-secondary">{children}</Collapsible.Content>
      </Collapsible.Root>
    );
  }

  return (
    <section className={SECTION} aria-label={title}>
      <h3 className={TITLE}>{title}</h3>
      <div className="text-[11px] text-text-secondary">{children}</div>
    </section>
  );
}
