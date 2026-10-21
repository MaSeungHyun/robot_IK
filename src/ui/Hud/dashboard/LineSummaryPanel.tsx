import { useMemo } from "react";
import { EQUIPMENT_REPORT_INTERVAL_MS } from "@/constants/telemetry";
import { computeLineMetrics } from "@/lib/lineMetrics";
import { useDerivedMetricsStore } from "@/stores/useDerivedMetricsStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import SmoothValue from "@/ui/Hud/equipment/details/_components/SmoothValue";
import { formatFixed, formatInteger } from "@/utils/equipment/formatMetric";

const smooth = (value: number | undefined, unit: string) => (
  <SmoothValue value={value} format={(v) => formatFixed(v, unit)} intervalMs={EQUIPMENT_REPORT_INTERVAL_MS} className="tabular-nums" />
);

/** Line-wide KPIs for the dashboard tab. Derived from the live equipment snapshot; energy integrates (mock) reported power. */
export default function LineSummaryPanel() {
  const equipment = useSimulationStore((state) => state.equipment);
  const agents = useDerivedMetricsStore((state) => state.agents);
  const energyKWh = useDerivedMetricsStore((state) => state.energyKWh);
  const metrics = useMemo(() => {
    const wait: Record<string, number> = {};
    for (const [id, history] of Object.entries(agents)) wait[id] = history.waitSeconds;
    return computeLineMetrics(equipment, wait);
  }, [equipment, agents]);

  return (
    <DetailSection title="라인 요약">
      <p className="mb-1.5 text-[11px] text-text-secondary">시뮬레이션 상태 기반 계산 · 에너지는 모의 전력 적산</p>
      <DetailRows rows={[
        { label: "시간당 처리량", value: <SmoothValue value={metrics.throughputPerHour} format={(v) => formatInteger(v, "개/h")} intervalMs={EQUIPMENT_REPORT_INTERVAL_MS} /> },
        { label: "OEE", value: smooth(metrics.oee, "%"), progress: metrics.oee },
        { label: "· 가용성", value: smooth(metrics.availability, "%"), progress: metrics.availability },
        { label: "· 성능", value: smooth(metrics.performance, "%"), progress: metrics.performance },
        { label: "· 품질", value: smooth(metrics.quality, "%"), progress: metrics.quality },
        { label: "병목 설비", value: metrics.bottleneck ? `${metrics.bottleneck.name} · ${metrics.bottleneck.reason}` : "없음" },
        { label: "누적 에너지 (모의)", value: smooth(equipment ? energyKWh : undefined, "kWh") },
        { label: "스캐너 불량률", value: smooth(metrics.defectRate, "%") },
        { label: "팔레트 적재율", value: smooth(metrics.palletFill, "%"), progress: metrics.palletFill },
      ]} />
    </DetailSection>
  );
}
