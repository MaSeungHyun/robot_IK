import { useMemo, useState } from "react";
import Select from "@/components/Select";
import { useCargoStore } from "@/stores/useCargoStore";
import { useSceneStore } from "@/stores/useSceneStore";
import type { CargoLogEntry, CargoLogType } from "@/domain/cargo/CargoRegistry";
import { fmtTime } from "@/ui/Hud/dashboard/full/format";

type RowType = CargoLogType | "request";
type Row = Omit<CargoLogEntry, "type" | "status"> & { type: RowType; status: CargoLogEntry["status"] | "대기" };

const TYPE_LABELS: Record<RowType, string> = {
  inbound: "투입", scanPass: "스캔 합격", scanDefect: "스캔 불량", load: "적재", palletFull: "팔레트 완료", request: "운반 대기", pickup: "AMR 픽업", outbound: "출고",
};
const TYPE_OPTIONS = [{ value: "all", label: "전체 유형" }, ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))];
const STATUS_OPTIONS = ["전체 상태", "완료", "진행", "대기", "불량"].map((value) => ({ value, label: value }));
/** Rendered row cap (newest first); filtering runs on the whole bounded log. */
const ROW_LIMIT = 500;

export default function HistoryTab() {
  const registry = useCargoStore((s) => s.registry);
  const transport = useCargoStore((s) => s.transport);
  const version = useCargoStore((s) => s.version);
  const objects = useSceneStore((s) => s.objects);
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("전체 상태");
  const [query, setQuery] = useState("");
  const names = useMemo(() => new Map(objects.map((o) => [o.id, o.name])), [objects]);
  const name = (id?: string) => (id ? names.get(id) ?? id : "—");

  const { rows, matched } = useMemo(() => {
    void version; // registry is mutable; the throttled version drives refreshes
    const all: Row[] = [...(registry?.log ?? [])];
    for (const task of transport?.queued() ?? [])
      all.push({ no: 0, t: task.createdAt, type: "request", targetId: task.palletId ?? task.id, from: task.stationId, status: "대기" });
    const q = query.trim().toLowerCase();
    const filtered = all.filter((row) =>
      (type === "all" || row.type === type) &&
      (status === "전체 상태" || row.status === status) &&
      (!q || [row.targetId, row.from, row.to, row.equipmentId, row.from && names.get(row.from), row.to && names.get(row.to), row.equipmentId && names.get(row.equipmentId)]
        .some((v) => v && v.toLowerCase().includes(q))));
    filtered.sort((a, b) => b.t - a.t || b.no - a.no);
    return { rows: filtered.slice(0, ROW_LIMIT), matched: filtered.length };
  }, [registry, transport, version, type, status, query, names]);

  if (!registry) return <p className="p-6 text-center text-xs text-text-secondary">시뮬레이션을 실행하면 처리 내역이 기록됩니다.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select label="유형" value={type} options={TYPE_OPTIONS} onValueChange={setType} widthClassName="w-32" />
        <Select label="상태" value={status} options={STATUS_OPTIONS} onValueChange={setStatus} widthClassName="w-28" />
        <input
          type="search"
          aria-label="검색"
          placeholder="ID · 설비 검색"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          className="h-6 w-48 rounded-[3px] border border-white/10 bg-bg-primary px-2 text-xs text-text-primary outline-none placeholder:text-text-secondary/60 focus:border-brand-primary"
        />
        <span className="ml-auto text-[11px] tabular-nums text-text-secondary">
          {matched.toLocaleString("ko-KR")}건{matched > ROW_LIMIT && ` · 최근 ${ROW_LIMIT}건 표시`}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin rounded-[3px] border border-white/10">
        <table className="w-full border-collapse text-left text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-bg-primary text-text-secondary">
            <tr>
              {["No", "유형", "대상 ID", "출발지", "목적지", "설비", "상태", "시각"].map((h) => (
                <th key={h} className="border-b border-white/10 px-2 py-1.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.type}-${row.no}-${row.targetId}-${i}`} className="border-b border-white/5 text-text-primary hover:bg-white/5">
                <td className="px-2 py-1 text-text-secondary">{row.no || "—"}</td>
                <td className="px-2 py-1">{TYPE_LABELS[row.type]}</td>
                <td className="px-2 py-1">{row.targetId}</td>
                <td className="px-2 py-1">{name(row.from)}</td>
                <td className="px-2 py-1">{name(row.to)}</td>
                <td className="px-2 py-1">{name(row.equipmentId)}</td>
                <td className={row.status === "불량" ? "px-2 py-1 text-fault" : row.status === "대기" ? "px-2 py-1 text-warning" : "px-2 py-1 text-text-secondary"}>{row.status}</td>
                <td className="px-2 py-1 text-text-secondary">{fmtTime(row.t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-6 text-center text-xs text-text-secondary">조건에 맞는 내역이 없습니다.</p>}
      </div>
    </div>
  );
}