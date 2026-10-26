import InfoTip from "@/components/InfoTip";
import Select from "@/components/Select";
import { KPI_CELL_SIZES, KPI_SAMPLE_INTERVALS, useKpiStore } from "@/stores/useKpiStore";

const INTERVALS = KPI_SAMPLE_INTERVALS.map((v) => ({ value: String(v), label: `${v}초` }));
const CELLS = KPI_CELL_SIZES.map((v) => ({ value: String(v), label: `${v} m` }));
const PANEL: readonly { value: "on" | "off"; label: string }[] = [
  { value: "on", label: "표시" },
  { value: "off", label: "숨김" },
];

/** KPI collection settings (settings menu). */
export default function KpiSettings() {
  const { sampleInterval, cellSize, panel, setSampleInterval, setCellSize, setPanel } = useKpiStore();
  return (
    <>
      <div className="mt-4">
        <p className="mb-2 flex items-center text-xs text-text-secondary">KPI 샘플 간격<InfoTip label="KPI 샘플 간격 설명" text="KPI를 모으는 시뮬레이션 시간 간격입니다. 배속과 무관하게 같은 결과가 나옵니다. 실행 중 바꾸면 다음 샘플부터 적용됩니다." /></p>
        <Select label="KPI 샘플 간격" value={String(sampleInterval)} options={INTERVALS} onValueChange={(v) => setSampleInterval(Number(v))} />
      </div>
      <div className="mt-4">
        <p className="mb-2 flex items-center text-xs text-text-secondary">혼잡 셀 크기<InfoTip label="혼잡 셀 크기 설명" text="AMR 점유 핫스팟을 집계하는 바닥 격자 한 칸의 크기입니다." /></p>
        <Select label="혼잡 셀 크기" value={String(cellSize)} options={CELLS} onValueChange={(v) => setCellSize(Number(v))} />
      </div>
      <div className="mt-4">
        <p className="mb-2 flex items-center text-xs text-text-secondary">KPI 패널<InfoTip label="KPI 패널 설명" text="대시보드 탭의 KPI 패널 표시 여부입니다. 숨겨도 수집은 계속됩니다." /></p>
        <Select label="KPI 패널" value={panel ? "on" : "off"} options={PANEL} onValueChange={(v) => setPanel(v === "on")} />
      </div>
    </>
  );
}