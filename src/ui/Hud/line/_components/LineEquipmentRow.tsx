import type { ReactNode } from "react";
import Badge from "@/components/Badge";
import type { BadgeTone } from "@/components/Badge";

type Props = {
  name: string;
  tone: BadgeTone | undefined;
  badge: string | undefined;
  first: ReactNode;
  second: ReactNode;
};

/** One equipment row: name, state badge and two right-aligned metric columns. */
export default function LineEquipmentRow({ name, tone, badge, first, second }: Props) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem_3.5rem] items-center gap-2 rounded-md bg-white/[.025] px-2 py-1 text-[11px]">
      <span className="truncate" title={name}>
        {name}
      </span>
      <Badge tone={tone ?? "idle"}>{badge ?? "—"}</Badge>
      <span className="text-right tabular-nums">{first}</span>
      <span className="text-right tabular-nums">{second}</span>
    </li>
  );
}
