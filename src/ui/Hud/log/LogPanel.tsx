import { useEffect, useRef } from "react";
import Icon from "@/components/Icon";
import useCollisionWarnings from "@/hooks/useCollisionWarnings";
import { useLogStore, type LogLevel } from "@/stores/useLogStore";
import { cn } from "@/lib/style";

const LEVEL: Record<LogLevel, { label: string; className: string }> = {
  info: { label: "INFO", className: "text-text-secondary" },
  warning: { label: "WARN", className: "text-warning" },
  error: { label: "ERROR", className: "text-fault" },
};
const time = (at: number) =>
  new Date(at).toLocaleTimeString("ko-KR", { hour12: false });

/** Collision-risk status line, live collision warnings and the app log (oldest first, newest at the bottom). */
export default function LogPanel() {
  const warnings = useCollisionWarnings();
  const entries = useLogStore((state) => state.entries);
  const clear = useLogStore((state) => state.clear);
  const list = useRef<HTMLOListElement>(null);
  const hasWarnings = warnings.length > 0;

  // Keep the newest entry in view.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [entries]);

  return (
    <section aria-label="로그" className="flex min-h-0 flex-col gap-2">
      <p
        role="status"
        className={cn(
          "flex items-center gap-1.5 text-xs",
          hasWarnings ? "text-warning" : "text-text-secondary",
        )}
      >
        <Icon
          icon={hasWarnings ? "TriangleAlert" : "CircleCheck"}
          aria-hidden="true"
          className={cn("size-4 shrink-0", !hasWarnings && "text-safe")}
        />
        {hasWarnings
          ? `설비 배치 문제 발생 가능 · ${warnings.length}건`
          : "충돌 위험 없음"}
      </p>
      {hasWarnings && (
        <ul className="max-h-28 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
          {warnings.map((warning) => (
            <li
              key={warning.id}
              className="rounded-md border border-warning/25 bg-warning/10 px-2 py-1 text-[11px] leading-4 text-warning"
            >
              <span className="whitespace-pre-wrap">{warning.message}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between border-t border-white/10 pt-2">
        <span className="text-[11px] text-text-secondary">
          로그 {entries.length}건
        </span>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="text-[11px] text-text-secondary hover:text-text-primary"
          >
            지우기
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="text-[11px] text-text-secondary">
          기록된 로그가 없습니다.
        </p>
      ) : (
        <ol
          ref={list}
          className="max-h-72 space-y-1 overflow-y-auto pr-1 font-mono text-[11px] leading-4 [scrollbar-width:thin]"
        >
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-sm bg-white/5 px-2 py-1">
              <span className="text-text-secondary">{time(entry.at)}</span>{" "}
              <span
                className={cn("font-semibold", LEVEL[entry.level].className)}
              >
                {LEVEL[entry.level].label}
              </span>{" "}
              <span className="text-text-primary">{entry.message}</span>
              {entry.detail && (
                <span className="block break-all text-text-secondary">
                  {entry.detail}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
