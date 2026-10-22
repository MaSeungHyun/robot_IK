import type { BadgeTone } from "@/components/Badge";
import { EQUIPMENT_REPORT_INTERVAL_MS, MOCK_TELEMETRY_CONFIG } from "@/constants/telemetry";
import type { ProductionLine } from "@/lib/productionLines";
import type { useSceneStore } from "@/stores/useSceneStore";
import type { useSimulationStore } from "@/stores/useSimulationStore";
import SmoothValue from "@/ui/Hud/equipment/details/_components/SmoothValue";
import { fixed } from "@/ui/Hud/line/_components/format";
import LineEquipmentRow from "@/ui/Hud/line/_components/LineEquipmentRow";
import { formatInteger, formatMetric } from "@/utils/equipment/formatMetric";

type SimulationState = ReturnType<typeof useSimulationStore.getState>;
type Equipment = NonNullable<SimulationState["equipment"]>;

const ROBOT_TONES: Record<string, BadgeTone> = { working: "operating", idle: "idle", disabled: "offline" };
const ROBOT_LABELS: Record<string, string> = { working: "가동", idle: "대기", disabled: "중지" };

type Props = {
  line: ProductionLine;
  robots: Equipment["robots"];
  equipment: SimulationState["equipment"];
  settings: ReturnType<typeof useSceneStore.getState>["settings"];
  telemetry: SimulationState["mockTelemetry"];
  running: boolean;
  elapsedHours: number | undefined;
  name: (id: string) => string;
};

/** Expanded view: robots, then belts, then scanners of the line, one row each. */
export default function LineEquipmentList({ line, robots, equipment, settings, telemetry, running, elapsedHours, name }: Props) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {robots.map((robot) => (
        <LineEquipmentRow
          key={robot.id}
          name={robot.name}
          tone={ROBOT_TONES[robot.state]}
          badge={ROBOT_LABELS[robot.state]}
          first={
            <SmoothValue
              value={elapsedHours ? robot.count / elapsedHours : undefined}
              format={(value) => formatInteger(value, "개/h")}
              intervalMs={EQUIPMENT_REPORT_INTERVAL_MS}
            />
          }
          second={<SmoothValue value={robot.utilization} format={fixed("%")} intervalMs={EQUIPMENT_REPORT_INTERVAL_MS} />}
        />
      ))}
      {line.beltIds.map((id) => {
        const enabled = settings[id]?.enabled !== false;
        return (
          <LineEquipmentRow
            key={id}
            name={name(id)}
            tone={!enabled ? "offline" : running ? "operating" : "idle"}
            badge={!enabled ? "중지" : running ? "이송" : "대기"}
            first={<span className="text-text-secondary">부하 (모의)</span>}
            second={
              <SmoothValue value={telemetry[id]?.motorLoadPercent} format={fixed("%")} intervalMs={MOCK_TELEMETRY_CONFIG.intervalMs} />
            }
          />
        );
      })}
      {line.scannerIds.map((id) => {
        const scanner = equipment?.scanners?.find((candidate) => candidate.id === id);
        const enabled = settings[id]?.enabled !== false;
        // Cumulative results (total passed, defect rate), not the last box's state.
        return (
          <LineEquipmentRow
            key={id}
            name={name(id)}
            tone={!enabled ? "offline" : running ? "operating" : "idle"}
            badge={!enabled ? "중지" : running ? "검사" : "대기"}
            first={<span className="tabular-nums">{formatMetric(scanner?.scanned ?? 0, "개", 0)}</span>}
            second={
              <SmoothValue
                value={scanner?.scanned ? (scanner.faults / scanner.scanned) * 100 : undefined}
                format={fixed("%")}
                intervalMs={EQUIPMENT_REPORT_INTERVAL_MS}
              />
            }
          />
        );
      })}
    </ul>
  );
}
