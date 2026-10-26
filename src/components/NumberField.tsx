import { useState } from "react";
import { cn } from "@/lib/style";
import InfoTip from "@/components/InfoTip";

type Props = {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  /** Unit suffix shown inside the field, e.g. "m/s". */
  unit?: string;
  min?: number;
  max?: number;
  /** `value > min` instead of `value >= min`. */
  exclusiveMin?: boolean;
  integer?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  /** Max decimals shown (default 4). Commits only when the typed value differs from the shown one. */
  decimals?: number;
  /** Multi-edit with differing values: the field shows an empty "혼합" placeholder and any valid entry commits. */
  mixed?: boolean;
  /** Always show exactly `decimals` digits (e.g. "30.0"); default trims trailing zeros. */
  fixedDecimals?: boolean;
  /** Explanation behind an (i) icon after the label. */
  info?: React.ReactNode;
};

const DRAFT = /^\d*\.?\d*$/;
const format = (value: number, decimals: number, fixed = false) =>
  fixed ? value.toFixed(decimals) : String(Number(value.toFixed(decimals)));

/**
 * Free-typing non-negative number input. Intermediate text ("1.", "") is allowed while typing;
 * the value is validated on blur/Enter (finite, ≥ 0, within min/max, integer if required) and
 * reverts to the last valid value when invalid. Esc reverts.
 */
export default function NumberField({
  label,
  value,
  onCommit,
  unit,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  exclusiveMin = false,
  integer = false,
  disabled = false,
  className,
  inputClassName,
  decimals = 4,
  mixed = false,
  fixedDecimals = false,
  info,
}: Props) {
  const shown = format(value, decimals, fixedDecimals);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const text = draft.trim(),
      next = Number(text);
    const valid =
      text !== "" &&
      text !== "." &&
      Number.isFinite(next) &&
      next >= 0 &&
      (exclusiveMin ? next > min : next >= min) &&
      next <= max &&
      (!integer || Number.isInteger(next));
    setDraft(null);
    // Unchanged (rounded) text keeps the stored value as is: no drift from display rounding.
    if (valid && (mixed || next !== Number(shown))) onCommit(next);
  };

  return (
    <label
      className={cn(
        "flex justify-between text-xs text-text-secondary",
        className,
      )}
    >
      <div className="min-w-24 overflow-hidden text-ellipsis whitespace-nowrap flex items-center">
        <span className="overflow-hidden text-ellipsis">{label}</span>{info && <InfoTip text={info} label={`${label} 설명`} />}
      </div>
      <span className="relative block">
        <input
          aria-label={label}
          type="text"
          inputMode={integer ? "numeric" : "decimal"}
          disabled={disabled}
          value={draft ?? (mixed ? "" : shown)}
          placeholder={mixed ? "혼합" : undefined}
          className={cn(inputClassName, unit && "pr-10")}
          onChange={(event) => {
            const text = event.currentTarget.value;
            if (DRAFT.test(text) && (!integer || !text.includes(".")))
              setDraft(text);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.stopPropagation();
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
        {unit && (
          <span className="pointer-events-none absolute top-1/2 right-2 mt-0.5 -translate-y-1/2 text-[11px] text-text-secondary">
            {unit}
          </span>
        )}
      </span>
    </label>
  );
}
