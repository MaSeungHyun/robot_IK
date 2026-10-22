import type { DashboardEquipment, DashboardSnapshot } from "@/domain/stats/dashboardStats";
import Card from "@/ui/Hud/dashboard/full/Card";
import { RankBars } from "@/ui/Hud/dashboard/full/charts";
import { SHARE_FILL, SHARE_LABELS } from "@/ui/Hud/dashboard/full/shareStyles";
import { fmtInt, fmtPct } from "@/ui/Hud/dashboard/full/format";
import type { TimeShareKey } from "@/domain/stats/dashboardStats";
import { cn } from "@/lib/style";

const STATE_LABELS: Record<string, string> = {
  working: "작업 중", idle: "대기", disabled: "비활성", pickup: "픽업 이동", loading: "적재", dispatch: "운반", unloading: "하역",
  storing: "랙 입고", returning: "복귀", blocked: "막힘", waiting: "대기", yielding: "양보", charging: "충전",
};

function rank(list: DashboardEquipment[], value: (e: DashboardEquipment) => number | null) {
  const sorted = [...list].sort((a, b) => (value(b) ?? -1) - (value(a) ?? -1));
  const rows = (items: DashboardEquipment[]) => items.map((e) => ({ id: e.id, name: e.name, value: value(e) }));
  return { top: rows(sorted.slice(0, 5)), bottom: rows(sorted.slice(-5).reverse()) };
}

function Ranking({ title, list, value, unit }: { title: string; list: DashboardEquipment[]; value: (e: DashboardEquipment) => number | null; unit: string }) {
  const { top, bottom } = rank(list, value);
  return (
    <Card title={title}>
      <p className="mb-1 text-[10px] text-text-secondary">상위</p>
      <RankBars rows={top} unit={unit} />
      {list.length > 5 && <>
        <p className="mb-1 mt-3 text-[10px] text-text-secondary">하위</p>
        <RankBars rows={bottom} unit={unit} />
      </>}
    </Card>
  );
}

export default function EquipmentTab({ data }: { data: DashboardSnapshot }) {
  const robots = data.equipment.filter((e) => e.kind === "robot"), amrs = data.equipment.filter((e) => e.kind === "amr");
  const keys = Object.keys(SHARE_LABELS) as TimeShareKey[];
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <Ranking title="로봇 사이클 (개/h)" list={robots} value={(e) => e.perHour} unit="" />
        <Ranking title="AMR 운반 (회/h)" list={amrs} value={(e) => e.perHour} unit="" />
        <Ranking title="가동률 (%)" list={data.equipment} value={(e) => e.utilization} unit="%" />
      </div>
      <Card title="설비별 지표">
        <div className="overflow-auto scrollbar-thin">
          <table className="w-full border-collapse text-left text-[11px] tabular-nums">
            <thead className="text-text-secondary">
              <tr>
                {["설비", "종류", "상태", "처리 수", "시간당", "가동률", "시간 비율"].map((h) => <th key={h} className="border-b border-white/10 px-2 py-1.5 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.equipment.map((e) => {
                const total = keys.reduce((s, k) => s + e.timeShare[k], 0);
                return (
                  <tr key={e.id} className="border-b border-white/5 text-text-primary">
                    <td className="px-2 py-1">{e.name}</td>
                    <td className="px-2 py-1 text-text-secondary">{e.kind === "robot" ? "로봇" : "AMR"}</td>
                    <td className={cn("px-2 py-1", e.state === "blocked" ? "text-fault" : "text-text-secondary")}>{STATE_LABELS[e.state] ?? e.state}</td>
                    <td className="px-2 py-1">{fmtInt(e.count, e.kind === "robot" ? " 개" : " 회")}</td>
                    <td className="px-2 py-1">{e.perHour == null ? "—" : e.perHour.toFixed(1)}</td>
                    <td className="px-2 py-1">{fmtPct(e.utilization)}</td>
                    <td className="w-48 px-2 py-1">
                      <div className="flex h-1.5 w-full overflow-hidden bg-white/5">
                        {total > 0 && keys.map((k) => <div key={k} title={SHARE_LABELS[k]} className={SHARE_FILL[k]} style={{ width: `${(e.timeShare[k] / total) * 100}%` }} />)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data.equipment.length && <p className="p-4 text-center text-xs text-text-secondary">로봇 또는 AMR이 없습니다.</p>}
        </div>
      </Card>
    </div>
  );
}