import type { DashboardSnapshot } from "@/domain/stats/dashboardStats";
import Card from "@/ui/Hud/dashboard/full/Card";
import { LineChart } from "@/ui/Hud/dashboard/full/charts";
import { fmtTime } from "@/ui/Hud/dashboard/full/format";

export default function TrendTab({ data }: { data: DashboardSnapshot }) {
  const buckets = data.buckets;
  const perHour = 3600 / data.bucketSeconds;
  const span = buckets.length ? `${fmtTime(buckets[0].t)} – ${fmtTime(buckets[buckets.length - 1].t + data.bucketSeconds)}` : undefined;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card title="처리량 (출고 개/h)" aside={span}>
        <LineChart values={buckets.map((b) => b.outbound * perHour)} label="처리량" unit=" 개/h" />
      </Card>
      <Card title="불량률 (%)" aside={span}>
        <LineChart values={buckets.map((b) => (b.scanned ? (b.defects / b.scanned) * 100 : null))} label="불량률" unit="%" />
      </Card>
      <Card title="가동률 (%)" aside={span}>
        <LineChart values={buckets.map((b) => (b.trackedSeconds ? (b.activeSeconds / b.trackedSeconds) * 100 : null))} label="가동률" unit="%" max={100} />
      </Card>
    </div>
  );
}