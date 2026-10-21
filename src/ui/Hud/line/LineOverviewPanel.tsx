import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Badge from "@/components/Badge";
import IconButton from "@/components/IconButton";
import type { BadgeTone } from "@/components/Badge";
import { EQUIPMENT_REPORT_INTERVAL_MS, MOCK_TELEMETRY_CONFIG } from "@/constants/telemetry";
import { computeLineMetrics } from "@/lib/lineMetrics";
import { deriveProductionLines } from "@/lib/productionLines";
import { cn } from "@/lib/style";
import { useDerivedMetricsStore } from "@/stores/useDerivedMetricsStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import SmoothValue from "@/ui/Hud/equipment/details/_components/SmoothValue";
import LineRateChart from "@/ui/Hud/line/LineRateChart";
import LineTimeShareDonut from "@/ui/Hud/line/LineTimeShareDonut";
import { formatFixed, formatInteger, formatMetric } from "@/utils/equipment/formatMetric";

const fixed = (unit: string) => (value: number) => formatFixed(value, unit);
const ROBOT_TONES: Record<string, BadgeTone> = { working: "operating", idle: "idle", disabled: "offline" };
const ROBOT_LABELS: Record<string, string> = { working: "가동", idle: "대기", disabled: "중지" };

/** Simplified production-line overview for the selected robot's line (top-left of the viewport, outside edit mode). */
export default function LineOverviewPanel() {
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);
  const selected = useSceneStore((state) => state.selected);
  const equipment = useSimulationStore((state) => state.equipment);
  const telemetry = useSimulationStore((state) => state.mockTelemetry);
  const running = useSimulationStore((state) => state.running);
  const shares = useDerivedMetricsStore((state) => state.robots);
  const history = useDerivedMetricsStore((state) => state.history);
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Expanded state is remembered per selected robot, so selecting another robot starts compact.
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const expanded = expandedFor !== null && expandedFor === selected;

  const lines = useMemo(() => deriveProductionLines(objects, settings), [objects, settings]);
  const line = selected ? lines.find((candidate) => candidate.robotIds.includes(selected)) : undefined;

  const metrics = useMemo(() => {
    if (!line || !equipment) return computeLineMetrics(null);
    return computeLineMetrics({
      ...equipment,
      robots: equipment.robots.filter((robot) => line.robotIds.includes(robot.id)),
      agents: [],
      scanners: equipment.scanners?.filter((scanner) => line.scannerIds.includes(scanner.id)),
      pallets: equipment.pallets.filter((pallet) => line.palletIds.includes(pallet.id)),
    });
  }, [line, equipment]);

  if (!line || dismissed === selected) return null;

  const name = (id: string) => objects.find((object) => object.id === id)?.name ?? id;
  const robots = equipment?.robots.filter((robot) => line.robotIds.includes(robot.id)) ?? [];
  const output = robots.reduce((sum, robot) => sum + robot.count, 0);
  const elapsedHours = equipment && equipment.elapsed > 0 ? equipment.elapsed / 3600 : undefined;
  const share = line.robotIds.reduce(
    (sum, id) => ({
      processing: sum.processing + (shares[id]?.processing ?? 0),
      transfer: sum.transfer + (shares[id]?.transfer ?? 0),
      wait: sum.wait + (shares[id]?.wait ?? 0),
    }),
    { processing: 0, transfer: 0, wait: 0 },
  );

  const tiles = [
    { label: "총 생산량", value: <span className="tabular-nums">{formatMetric(output, "개", 0)}</span>, tone: "text-brand-primary" },
    { label: "가동률", value: <SmoothValue value={metrics.availability} format={fixed("%")} intervalMs={EQUIPMENT_REPORT_INTERVAL_MS} />, tone: "text-safe" },
    { label: "품질", value: <SmoothValue value={metrics.quality} format={fixed("%")} intervalMs={EQUIPMENT_REPORT_INTERVAL_MS} />, tone: "text-info" },
    { label: "OEE", value: <SmoothValue value={metrics.oee} format={fixed("%")} intervalMs={EQUIPMENT_REPORT_INTERVAL_MS} />, tone: "text-warning" },
  ];

  return (
    <aside
      aria-label={`${line.name} 생산 라인 개요`}
      className={cn("simulation-panel absolute top-3 left-3 z-200 max-h-[calc(100%-1.5rem)] overflow-y-auto scrollbar-thin [scrollbar-gutter:stable] ", expanded ? "w-[440px]" : "w-[380px]", "max-w-[calc(100%-1.5rem)] rounded-lg border border-white/10 bg-bg-primary/85 p-3 text-text-primary shadow-lg backdrop-blur-lg")}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] tracking-wider text-brand-primary">PRODUCTION LINE</p>
          <h2 className="truncate text-sm font-semibold text-text-primary" title={line.name}>{line.name}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge tone={running ? "operating" : "idle"}>{running ? "가동 중" : "일시 정지"}</Badge>
          <IconButton
            icon={expanded ? "Minimize2" : "Maximize2"}
            label={expanded ? "축소" : "확대"}
            aria-expanded={expanded}
            onClick={() => setExpandedFor(expanded ? null : selected)}
          />
          <IconButton icon="X" label="닫기" onClick={() => setDismissed(selected)} />
        </div>
      </header>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {tiles.map(({ label, value, tone }) => (
          <div key={label} className="rounded-lg bg-white/[.035] px-2 py-1.5">
            <p className="text-[10px] text-text-secondary">{label}</p>
            <p className={cn("mt-0.5 text-[13px] font-semibold tabular-nums", tone)}>{value ?? "—"}</p>
          </div>
        ))}
      </div>

      {expanded && (<>
      <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
        <div className="rounded-lg bg-white/[.035] p-2">
          <p className="text-[10px] text-text-secondary">생산 속도 (개/h · 최근 시뮬레이션 시간)</p>
          <LineRateChart history={history} robotIds={line.robotIds} />
        </div>
        <div className="rounded-lg bg-white/[.035] p-2">
          <p className="text-[10px] text-text-secondary">공정 시간 비율</p>
          <LineTimeShareDonut share={share} />
        </div>
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        {robots.map((robot) => (
          <EquipmentRow key={robot.id} name={robot.name} tone={ROBOT_TONES[robot.state]} badge={ROBOT_LABELS[robot.state]}
            first={<SmoothValue value={elapsedHours ? robot.count / elapsedHours : undefined} format={(value) => formatInteger(value, "개/h")} intervalMs={EQUIPMENT_REPORT_INTERVAL_MS} />}
            second={<SmoothValue value={robot.utilization} format={fixed("%")} intervalMs={EQUIPMENT_REPORT_INTERVAL_MS} />} />
        ))}
        {line.beltIds.map((id) => {
          const enabled = settings[id]?.enabled !== false;
          return (
            <EquipmentRow key={id} name={name(id)} tone={!enabled ? "offline" : running ? "operating" : "idle"} badge={!enabled ? "중지" : running ? "이송" : "대기"}
              first={<span className="text-text-secondary">부하 (모의)</span>}
              second={<SmoothValue value={telemetry[id]?.motorLoadPercent} format={fixed("%")} intervalMs={MOCK_TELEMETRY_CONFIG.intervalMs} />} />
          );
        })}
        {line.scannerIds.map((id) => {
          const scanner = equipment?.scanners?.find((candidate) => candidate.id === id);
          return (
            <EquipmentRow key={id} name={name(id)} tone={scanner?.lastResult === "fault" ? "fault" : "safe"} badge={scanner?.lastResult === "fault" ? "불량" : "정상"}
              first={<span className="tabular-nums">{formatMetric(scanner?.scanned ?? 0, "개", 0)}</span>}
              second={<SmoothValue value={scanner?.scanned ? (scanner.faults / scanner.scanned) * 100 : undefined} format={fixed("%")} intervalMs={EQUIPMENT_REPORT_INTERVAL_MS} />} />
          );
        })}
      </ul>
      </>)}
    </aside>
  );
}

type RowProps = { name: string; tone: BadgeTone | undefined; badge: string | undefined; first: ReactNode; second: ReactNode };

function EquipmentRow({ name, tone, badge, first, second }: RowProps) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem_3.5rem] items-center gap-2 rounded-md bg-white/[.025] px-2 py-1 text-[11px]">
      <span className="truncate" title={name}>{name}</span>
      <Badge tone={tone ?? "idle"}>{badge ?? "—"}</Badge>
      <span className="text-right tabular-nums">{first}</span>
      <span className="text-right tabular-nums">{second}</span>
    </li>
  );
}
