import Icon from "@/components/Icon";
import useCollisionWarnings from "@/hooks/useCollisionWarnings";

/** Compact collision-risk log: a status line plus the live warning entries. */
export default function LogPanel() {
  const warnings = useCollisionWarnings();
  const hasWarnings = warnings.length > 0;

  return (
    <section aria-label="로그" className="mb-3 shrink-0">
      <p
        role="status"
        className={
          hasWarnings
            ? "flex items-center gap-1.5 text-xs text-warning"
            : "flex items-center gap-1.5 text-xs text-text-secondary"
        }
      >
        <Icon
          icon={hasWarnings ? "TriangleAlert" : "CircleCheck"}
          aria-hidden="true"
          className={
            hasWarnings ? "size-4 shrink-0" : "size-4 shrink-0 text-safe"
          }
        />
        {hasWarnings
          ? `설비 배치 문제 발생 가능 · ${warnings.length}건`
          : "충돌 위험 없음"}
      </p>

      {/* {hasWarnings && (
        <ul className="mt-1.5 max-h-28 space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
          {warnings.map((warning) => (
            <li
              key={warning.id}
              className="rounded-md border border-warning/25 bg-warning/10 px-2 py-1 text-[11px] leading-4 text-warning"
            >
              <span className="whitespace-pre-wrap">{warning.message}</span>
            </li>
          ))}
        </ul>
      )} */}
    </section>
  );
}
