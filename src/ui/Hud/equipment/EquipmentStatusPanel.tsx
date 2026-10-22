import { useMemo, useState } from "react";
import Badge from "@/components/Badge";
import Button from "@/components/Button";
import RobotStatusSection from "@/ui/Hud/equipment/robot/RobotStatusSection";
import AMRStatusSection from "@/ui/Hud/equipment/amr/AMRStatusSection";
import StaticEquipmentSection from "@/ui/Hud/equipment/StaticEquipmentSection";
import {
  KIND_FILTERS,
  STATUS_SUMMARY,
  agentState,
  conveyorState,
  robotState,
  scannerState,
  type EquipmentState,
  type KindFilter,
} from "@/ui/Hud/equipment/equipmentStatus";
import Panel from "@/ui/Hud/_components/Panel";
import { cn } from "@/lib/style";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useSceneStore } from "@/stores/useSceneStore";

export default function EquipmentStatusPanel() {
  const equipment = useSimulationStore((state) => state.equipment);
  const running = useSimulationStore((state) => state.running);
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<EquipmentState | null>(null);

  // One entry per listed equipment; the outbound area (dock) is not equipment status.
  const entries = useMemo(() => {
    if (!equipment) return [];
    const list: {
      id: string;
      kind: Exclude<KindFilter, "all">;
      state: EquipmentState;
    }[] = [
      ...equipment.robots.map((robot) => ({
        id: robot.id,
        kind: "robot" as const,
        state: robotState(robot.state),
      })),
      ...equipment.agents.map((agent) => ({
        id: agent.id,
        kind: "amr" as const,
        state: agentState(agent),
      })),
    ];
    for (const object of objects) {
      const enabled = settings[object.id]?.enabled;
      if (object.kind === "conveyor")
        list.push({
          id: object.id,
          kind: "conveyor",
          state: conveyorState(enabled, running),
        });
      if (object.kind === "scanner")
        list.push({
          id: object.id,
          kind: "scanner",
          state: scannerState(
            enabled,
            equipment.scanners?.find((scanner) => scanner.id === object.id),
          ),
        });
    }
    return list;
  }, [equipment, objects, settings, running]);

  const kinds = useMemo(
    () =>
      KIND_FILTERS.filter(
        ({ value }) =>
          value === "all" || entries.some((entry) => entry.kind === value),
      ),
    [entries],
  );
  const activeKind = kinds.some(({ value }) => value === kind) ? kind : "all";
  const visible = useMemo(
    () =>
      new Set(
        entries
          .filter(
            (entry) =>
              (activeKind === "all" || entry.kind === activeKind) &&
              (!status || entry.state === status),
          )
          .map((entry) => entry.id),
      ),
    [entries, activeKind, status],
  );
  const filtered = activeKind !== "all" || status !== null;
  const counts = useMemo(
    () =>
      STATUS_SUMMARY.map((item) => ({
        ...item,
        count: entries.filter((entry) => entry.state === item.state).length,
      })).filter((item) => item.count > 0),
    [entries],
  );
  const lists = useMemo(() => {
    const show = <T extends { id: string }>(items: T[]) =>
      items.filter((item) => visible.has(item.id));
    return {
      robots: show(equipment?.robots ?? []),
      agents: show(equipment?.agents ?? []),
      conveyors: show(objects.filter((object) => object.kind === "conveyor")),
      scanners: show(objects.filter((object) => object.kind === "scanner")),
    };
  }, [equipment, objects, visible]);

  return (
    <Panel
      aria-label="장비 현황"
      className="min-h-0 shrink overflow-hidden shadow-xl h-full"
    >
      {/* Fixed header: title, status summary and kind filter never scroll. */}
      <div className="shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">장비 현황</h2>
          <Badge tone={running ? "operating" : "idle"}>
            {running ? "실행 중" : "일시 정지"}
          </Badge>
        </div>

        {equipment && (
          <div
            aria-label="상태별 장비 수"
            className="mb-3 flex flex-wrap gap-1.5 flex-col"
          >
            <div>
              <span className="text-xs text-text-primary flex items-center mt-1 mr-1">
                전체 {entries.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {counts.map(({ state, tone, label, count }) => (
                <button
                  key={state}
                  type="button"
                  aria-pressed={status === state}
                  title={`${label} 상태만 보기`}
                  onClick={() => setStatus(status === state ? null : state)}
                  className={cn(
                    "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                    status && status !== state && "opacity-40",
                  )}
                >
                  <Badge tone={tone}>
                    {label} {count}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {equipment && kinds.length > 2 && (
          <div
            role="group"
            aria-label="장비 종류 필터"
            className="mb-3 flex flex-wrap gap-1"
          >
            {kinds.map(({ value, label }) => (
              <Button
                key={value}
                aria-pressed={activeKind === value}
                active={activeKind === value}
                onClick={() => setKind(value)}
                className="h-6 px-2 text-xs"
              >
                {label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Only the equipment list scrolls, bounded by the panel height. */}

      {!equipment ? (
        <p className="text-xs text-text-secondary">
          장비 상태를 준비하고 있습니다.
        </p>
      ) : (
        <div className="flex flex-col gap-2 min-h-0 overflow-y-auto -mr-4 pr-2.5 [scrollbar-gutter:stable] scrollbar-thin">
          {(!filtered || lists.robots.length > 0) && (
            <RobotStatusSection robots={lists.robots} />
          )}

          {(!filtered || lists.agents.length > 0) && (
            <AMRStatusSection agents={lists.agents} />
          )}

          <StaticEquipmentSection title="컨베이어" objects={lists.conveyors} />

          <StaticEquipmentSection title="스캐너" objects={lists.scanners} />

          {filtered && visible.size === 0 && (
            <p className="mt-2 text-[11px] text-text-secondary">
              조건에 맞는 장비가 없습니다.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
