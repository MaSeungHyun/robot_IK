import { useMemo, useState } from "react";
import { computeLineMetrics } from "@/lib/lineMetrics";
import { deriveProductionLines } from "@/lib/productionLines";
import { cn } from "@/lib/style";
import { useDerivedMetricsStore } from "@/stores/useDerivedMetricsStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import LineCharts from "@/ui/Hud/line/_components/LineCharts";
import LineEquipmentList from "@/ui/Hud/line/_components/LineEquipmentList";
import LineOverviewHeader from "@/ui/Hud/line/_components/LineOverviewHeader";
import LineSummaryTiles from "@/ui/Hud/line/_components/LineSummaryTiles";

/**
 * Simplified production-line overview for the selected robot's line (top-left of the viewport,
 * outside edit mode). Container: reads the stores and derives the line data; the parts under
 * `_components/` are presentational.
 */
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

  const lines = useMemo(
    () => deriveProductionLines(objects, settings),
    [objects, settings],
  );
  const line = selected
    ? lines.find((candidate) => candidate.robotIds.includes(selected))
    : undefined;

  const metrics = useMemo(() => {
    if (!line || !equipment) return computeLineMetrics(null);
    return computeLineMetrics({
      ...equipment,
      robots: equipment.robots.filter((robot) =>
        line.robotIds.includes(robot.id),
      ),
      agents: [],
      scanners: equipment.scanners?.filter((scanner) =>
        line.scannerIds.includes(scanner.id),
      ),
      pallets: equipment.pallets.filter((pallet) =>
        line.palletIds.includes(pallet.id),
      ),
    });
  }, [line, equipment]);

  if (!line || dismissed === selected) return null;

  const name = (id: string) =>
    objects.find((object) => object.id === id)?.name ?? id;
  const robots =
    equipment?.robots.filter((robot) => line.robotIds.includes(robot.id)) ?? [];
  const output = robots.reduce((sum, robot) => sum + robot.count, 0);
  const elapsedHours =
    equipment && equipment.elapsed > 0 ? equipment.elapsed / 3600 : undefined;
  const share = line.robotIds.reduce(
    (sum, id) => ({
      processing: sum.processing + (shares[id]?.processing ?? 0),
      transfer: sum.transfer + (shares[id]?.transfer ?? 0),
      wait: sum.wait + (shares[id]?.wait ?? 0),
    }),
    { processing: 0, transfer: 0, wait: 0 },
  );

  return (
    <aside
      aria-label={`${line.name} 생산 라인 개요`}
      className={cn(
        "w-120",
        "simulation-panel absolute top-3 left-3 z-200 max-h-[calc(100%-1.5rem)] overflow-y-auto scrollbar-thin",
        "max-w-[calc(100%-1.5rem)] rounded-lg border border-white/10 bg-bg-primary/80 p-3 text-text-primary shadow-lg backdrop-blur-lg",
      )}
    >
      <LineOverviewHeader
        lineName={line.name}
        running={running}
        expanded={expanded}
        onToggleExpanded={() => setExpandedFor(expanded ? null : selected)}
        onClose={() => setDismissed(selected)}
      />
      <LineSummaryTiles
        output={output}
        availability={metrics.availability}
        quality={metrics.quality}
        oee={metrics.oee}
      />
      {expanded && (
        <>
          <LineCharts
            history={history}
            robotIds={line.robotIds}
            share={share}
          />
          <LineEquipmentList
            line={line}
            robots={robots}
            equipment={equipment}
            settings={settings}
            telemetry={telemetry}
            running={running}
            elapsedHours={elapsedHours}
            name={name}
          />
        </>
      )}
    </aside>
  );
}
