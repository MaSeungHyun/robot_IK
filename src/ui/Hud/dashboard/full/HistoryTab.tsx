import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Select from "@/components/Select";
import { useCargoStore } from "@/stores/useCargoStore";
import { useSceneStore } from "@/stores/useSceneStore";
import type { CargoLogEntry, CargoLogType } from "@/domain/cargo/CargoRegistry";
import { fmtTime } from "@/ui/Hud/dashboard/full/format";

type RowType = CargoLogType | "request";
type Row = Omit<CargoLogEntry, "type" | "status"> & {
  type: RowType;
  status: CargoLogEntry["status"] | "대기";
};

const TYPE_LABELS: Record<RowType, string> = {
  inbound: "투입",
  scanPass: "스캔 합격",
  scanDefect: "스캔 불량",
  load: "적재",
  palletFull: "팔레트 완료",
  request: "운반 대기",
  pickup: "AMR 픽업",
  outbound: "출고",
};
const TYPE_OPTIONS = [
  { value: "all", label: "전체 유형" },
  ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
];
const STATUS_OPTIONS = ["전체 상태", "완료", "진행", "대기", "불량"].map(
  (value) => ({ value, label: value }),
);
/** Rendered row cap (newest first); filtering runs on the whole bounded log. */
const ROW_LIMIT = 5000;
const ROW_HEIGHT = 24;
const OVERSCAN = 10;
const COLS = "grid grid-cols-[56px_96px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_56px_72px]";
const HEADERS = ["No", "유형", "대상 ID", "출발지", "목적지", "설비", "상태", "시각"];

/** Cargo version sampled at a low rate so the table does not rebuild at the 4 Hz HUD rate. */
function useThrottledVersion(intervalMs: number) {
  const [version, setVersion] = useState(() => useCargoStore.getState().version);
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = useCargoStore.getState().version;
      setVersion((prev) => (prev === v ? prev : v));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return version;
}

const HistoryRow = memo(function HistoryRow({
  row,
  top,
  name,
}: {
  row: Row;
  top: number;
  name: (id?: string) => string;
}) {
  const statusClass =
    row.status === "불량"
      ? "text-fault"
      : row.status === "대기"
        ? "text-warning"
        : "text-text-secondary";
  return (
    <div
      className={`${COLS} absolute inset-x-0 items-center border-b border-white/5 text-text-primary hover:bg-white/5 [&>span]:truncate [&>span]:px-2`}
      style={{ top, height: ROW_HEIGHT }}
    >
      <span className="text-text-secondary">{row.no || "—"}</span>
      <span>{TYPE_LABELS[row.type]}</span>
      <span>{row.targetId}</span>
      <span>{name(row.from)}</span>
      <span>{name(row.to)}</span>
      <span>{name(row.equipmentId)}</span>
      <span className={statusClass}>{row.status}</span>
      <span className="text-text-secondary">{fmtTime(row.t)}</span>
    </div>
  );
});

export default function HistoryTab() {
  const registry = useCargoStore((s) => s.registry);
  const transport = useCargoStore((s) => s.transport);
  const version = useThrottledVersion(1000);
  const objects = useSceneStore((s) => s.objects);
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("전체 상태");
  const [query, setQuery] = useState("");
  const names = useMemo(
    () => new Map(objects.map((o) => [o.id, o.name])),
    [objects],
  );
  const name = useCallback(
    (id?: string) => (id ? (names.get(id) ?? id) : "—"),
    [names],
  );

  const { rows, matched } = useMemo(() => {
    void version; // registry is mutable; the throttled version drives refreshes
    const all: Row[] = [...(registry?.log ?? [])];
    for (const task of transport?.queued() ?? [])
      all.push({
        no: 0,
        t: task.createdAt,
        type: "request",
        targetId: task.palletId ?? task.id,
        from: task.stationId,
        status: "대기",
      });
    const q = query.trim().toLowerCase();
    const filtered = all.filter(
      (row) =>
        (type === "all" || row.type === type) &&
        (status === "전체 상태" || row.status === status) &&
        (!q ||
          [
            row.targetId,
            row.from,
            row.to,
            row.equipmentId,
            row.from && names.get(row.from),
            row.to && names.get(row.to),
            row.equipmentId && names.get(row.equipmentId),
          ].some((v) => v && v.toLowerCase().includes(q))),
    );
    filtered.sort((a, b) => b.t - a.t || b.no - a.no);
    return { rows: filtered.slice(0, ROW_LIMIT), matched: filtered.length };
  }, [registry, transport, version, type, status, query, names]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [registry]);
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN,
  );

  if (!registry)
    return (
      <p className="p-6 text-center text-xs text-text-secondary">
        시뮬레이션을 실행하면 처리 내역이 기록됩니다.
      </p>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="유형"
          value={type}
          options={TYPE_OPTIONS}
          onValueChange={setType}
          widthClassName="w-32"
        />
        <Select
          label="상태"
          value={status}
          options={STATUS_OPTIONS}
          onValueChange={setStatus}
          widthClassName="w-28"
        />
        <input
          type="search"
          aria-label="검색"
          placeholder="ID · 설비 검색"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          className="h-6 w-48 rounded-[3px] border border-white/10 bg-bg-primary px-2 text-xs text-text-primary outline-none placeholder:text-text-secondary/60 focus:border-brand-primary"
        />
        <span className="ml-auto text-[11px] tabular-nums text-text-secondary">
          {matched.toLocaleString("ko-KR")}건
          {matched > ROW_LIMIT && ` · 최근 ${ROW_LIMIT}건 표시`}
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto scrollbar-thin simulation-panel rounded-[3px] border border-white/10 text-left text-[11px] tabular-nums"
      >
        <div
          className={`${COLS} sticky top-0 z-10 border-b border-white/10 bg-bg-primary font-medium text-text-secondary [&>span]:px-2 [&>span]:py-1.5`}
        >
          {HEADERS.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
          {rows.slice(first, last).map((row, i) => (
            <HistoryRow
              key={`${row.type}-${row.no}-${row.targetId}-${first + i}`}
              row={row}
              top={(first + i) * ROW_HEIGHT}
              name={name}
            />
          ))}
        </div>
        {!rows.length && (
          <p className="p-6 text-center text-xs text-text-secondary">
            조건에 맞는 내역이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
