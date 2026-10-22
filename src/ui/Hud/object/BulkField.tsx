import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { useSceneStore } from "@/stores/useSceneStore";
import {
  applyToIds,
  idsOfKind,
  type SettingsPatch as Patch,
} from "@/stores/actions/applyEquipmentSettings";
import NumberField from "@/components/NumberField";
import type { EquipmentKind, EquipmentSettings } from "@/types/layout";
import { cn } from "@/lib/style";

/**
 * "일괄" button: applies one field's value to every object of the same kind (one undo step) and
 * briefly shows how many it covers.
 */
export function ApplyAllButton({
  kind,
  patch,
  filter,
  disabled,
  className,
}: {
  kind: EquipmentKind;
  patch: Patch;
  filter?: (id: string) => boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <span className={cn("relative shrink-0")}>
      <button
        type="button"
        disabled={disabled}
        title="같은 종류의 모든 설비에 이 값을 적용"
        aria-label="같은 종류 전체에 일괄 적용"
        className={cn(
          "h-6 rounded-[3px] border border-[#2c2e33] bg-[#1b1c1f] px-1.5 text-[11px] text-text-secondary outline-none hover:border-[#3a3d43] hover:text-text-primary focus-visible:border-brand-primary disabled:opacity-40 disabled:hover:border-[#2c2e33]",
          className,
        )}
        onClick={() => {
          const ids = idsOfKind(kind, filter);
          const changed = applyToIds(ids, patch);
          setMessage(changed ? `${ids.length}개 적용됨` : "이미 동일");
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setMessage(null), 1600);
        }}
      >
        일괄 적용
      </button>
      {message && (
        <span
          role="status"
          className="pointer-events-none absolute top-full right-0 z-10 mt-0.5 whitespace-nowrap rounded-[3px] border border-[#2c2e33] bg-brand-primary/50 px-1.5 py-0.5 text-[11px] text-text-primary"
        >
          {message}
        </span>
      )}
    </span>
  );
}

type BulkNumberProps = Omit<
  ComponentProps<typeof NumberField>,
  "value" | "onCommit" | "mixed"
> & {
  /** Targets edited together; the last one is the primary (its value is shown / applied to all). */
  ids: string[];
  kind: EquipmentKind;
  read: (config: EquipmentSettings) => number;
  write: (
    value: number,
    config: EquipmentSettings,
  ) => Partial<EquipmentSettings>;
  /** Restricts the "일괄 적용" targets (e.g. conveyors that take boxes in). */
  applyFilter?: (id: string) => boolean;
};

/** NumberField editing every id at once ("혼합" when they differ) plus a per-field "일괄 적용" button. */
export function BulkNumber({
  ids,
  kind,
  read,
  write,
  applyFilter,
  className,
  ...field
}: BulkNumberProps) {
  const values = useSceneStore((state) =>
    ids
      .map((id) => (state.settings[id] ? read(state.settings[id]) : NaN))
      .join("|"),
  );
  const list = values.split("|").map(Number);
  const value = list[list.length - 1];
  if (!Number.isFinite(value)) return null;
  const mixed = list.some((entry) => entry !== value);
  return (
    <div className={`flex items-end gap-1 ${className ?? ""}`}>
      <NumberField
        {...field}
        className="min-w-0 flex-1"
        value={value}
        mixed={mixed}
        onCommit={(next) => applyToIds(ids, (config) => write(next, config))}
      />
      <ApplyAllButton
        kind={kind}
        filter={applyFilter}
        disabled={field.disabled}
        patch={(config) => write(value, config)}
      />
    </div>
  );
}
