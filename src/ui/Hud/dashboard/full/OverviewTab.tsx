import type { DashboardSnapshot } from "@/domain/stats/dashboardStats";
import Card, { Kpi } from "@/ui/Hud/dashboard/full/Card";
import { BarLineChart, ShareBar } from "@/ui/Hud/dashboard/full/charts";
import { fmtChange, fmtDuration, fmtInt, fmtPct, fmtTime } from "@/ui/Hud/dashboard/full/format";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";

export default function OverviewTab({ data }: { data: DashboardSnapshot }) {
  const k = data.kpi, b = data.bottleneck;
  const buckets = data.buckets.slice(-60);
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="처리량 (평균)" value={fmtInt(k.throughputPerHour, " 개/h")} sub="출고 박스 기준" />
        <Kpi label="투입 누적" value={fmtInt(k.inbound, " 개")} sub={`직전 구간 대비 ${fmtChange(k.inboundChangePct)}`} />
        <Kpi label="출고 누적" value={fmtInt(k.outbound, " 개")} sub={`팔레트 ${fmtInt(k.outboundPallets)} · ${fmtChange(k.outboundChangePct)}`} />
        <Kpi label="불량률" value={fmtPct(k.defectRate)} sub="스캔 기준" />
        <Kpi label="품질" value={fmtPct(k.quality)} sub="1 − 불량률" />
        <Kpi label="가동률" value={fmtPct(k.utilization)} sub="작업+이동 시간" />
        <Kpi label="OEE" value={fmtPct(k.oee)} sub={`가용 ${fmtPct(k.availability, 0)}`} />
        <Kpi label="평균 리드타임" value={fmtDuration(k.avgLeadTimeS)} sub="투입 → 출고" />
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="구간별 투입 / 출고" aside={`${data.bucketSeconds / 60}분 단위 · 시뮬레이션 시간`}>
          <BarLineChart
            labels={buckets.map((x) => fmtTime(x.t))}
            a={buckets.map((x) => x.inbound)}
            b={buckets.map((x) => x.outbound)}
            aLabel="투입"
            bLabel="출고"
          />
        </Card>
        <div className="grid gap-3">
          <Card title="시간 비율" aside="로봇 + AMR">
            <ShareBar share={data.timeShare} />
          </Card>
          <Card title="병목">
            <DetailRows rows={[
              { label: "운반 대기 작업", value: `${b.transportQueued}건` },
              { label: "운반 대기 평균", value: fmtDuration(b.transportAvgWaitS) },
              { label: "컨베이어 대기 박스", value: `${b.conveyorQueued}개` },
              { label: "팔레트 완료 → AMR 배정", value: fmtDuration(b.pickupWaitAvgS) },
            ]} />
          </Card>
        </div>
      </div>
    </div>
  );
}