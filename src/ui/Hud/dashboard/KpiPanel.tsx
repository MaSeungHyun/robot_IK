import { useKpiStore } from "@/stores/useKpiStore";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";

const f1 = (v: number) => v.toFixed(1);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** KPIs from domain/kpi (sampled on sim time; same at every playback speed). */
export default function KpiPanel() {
  const report = useKpiStore((state) => state.report);
  if (!report || !report.samples) return (
    <DetailSection title="KPI">
      <p className="text-[11px] text-text-secondary">시뮬레이션을 실행하면 KPI가 수집됩니다.</p>
    </DetailSection>
  );
  const top = report.congestion.hotspots[0], b = report.bottleneck;
  const avg = report.equipment.length ? report.equipment.reduce((a, e) => a + e.utilization, 0) / report.equipment.length : 0;
  return (
    <DetailSection title="KPI">
      <p className="mb-1.5 text-[11px] text-text-secondary">시뮬레이션 {f1(report.elapsed)}초 · {report.interval}초 간격 샘플</p>
      <DetailRows rows={[
        { label: "투입 / 적재", value: `${report.counters.boxesIn} / ${report.counters.placed}개` },
        { label: "적재 처리량", value: `${f1(report.perHour.placed)}개/h` },
        { label: "팔레트 입고 / 출고", value: `${report.counters.palletsIn} / ${report.counters.palletsShipped}` },
        { label: "출고 처리량", value: `${f1(report.perHour.palletsShipped)}개/h` },
        { label: "평균 가동률", value: pct(avg), progress: avg * 100 },
        { label: "병목 설비", value: b ? `${b.name} · ${pct(b.utilization)}${b.reason === "blocking" ? " · 막힘" : ""}` : "없음" },
        { label: "박스 체류", value: `${f1(report.waiting.boxQueueSeconds)}초 · WIP ${f1(report.waiting.avgWip)}` },
        { label: "도크/배정 대기", value: `${f1(report.waiting.dockWaitSeconds)}초` },
        { label: "교통 대기", value: `${f1(report.congestion.trafficWaitSeconds)}초` },
        { label: "혼잡 셀", value: top ? `(${f1(top.x)}, ${f1(top.z)}) · ${f1(top.seconds)}초` : "없음" },
      ]} />
    </DetailSection>
  );
}