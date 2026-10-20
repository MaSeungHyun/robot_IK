import { useMemo, useState } from "react";
import Badge, { type BadgeTone } from "@/components/Badge";
import Button from "@/components/Button";
import RobotStatusSection from "@/features/Hud/equipment/robot/RobotStatusSection";
import AMRStatusSection from "@/features/Hud/equipment/amr/AMRStatusSection";
import StaticEquipmentSection from "@/features/Hud/equipment/StaticEquipmentSection";
import {
  AGENT_TONES,
  KIND_FILTERS,
  ROBOT_STATUSES,
  STATUS_SUMMARY,
  conveyorStatus,
  scannerStatus,
  type KindFilter,
} from "@/features/Hud/equipment/equipmentStatus";
import Panel from "@/features/Hud/_components/Panel";
import ScrollFade from "@/components/ScrollFade";
import { cn } from "@/lib/style";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useSceneStore } from "@/stores/useSceneStore";

export default function EquipmentStatusPanel() {
  const equipment = useSimulationStore((state) => state.equipment);
  const running = useSimulationStore((state) => state.running);
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<BadgeTone | null>(null);

  // One entry per listed equipment; the outbound area (dock) is not equipment status.
  const entries = useMemo(() => {
    if (!equipment) return [];
    const list: {
      id: string;
      kind: Exclude<KindFilter, "all">;
      tone: BadgeTone;
    }[] = [
      ...equipment.robots.map((robot) => ({
        id: robot.id,
        kind: "robot" as const,
        tone: ROBOT_STATUSES[robot.state].tone,
      })),
      ...equipment.agents.map((agent) => ({
        id: agent.id,
        kind: "amr" as const,
        tone: AGENT_TONES[agent.state],
      })),
    ];
    for (const object of objects) {
      const enabled = settings[object.id]?.enabled;
      if (object.kind === "conveyor")
        list.push({
          id: object.id,
          kind: "conveyor",
          tone: conveyorStatus(enabled, running).tone,
        });
      if (object.kind === "scanner")
        list.push({
          id: object.id,
          kind: "scanner",
          tone: scannerStatus(
            enabled,
            equipment.scanners?.find((scanner) => scanner.id === object.id),
          ).tone,
        });
    }
    return list;
  }, [equipment, objects, settings, running]);

  const kinds = KIND_FILTERS.filter(
    ({ value }) =>
      value === "all" || entries.some((entry) => entry.kind === value),
  );
  const activeKind = kinds.some(({ value }) => value === kind) ? kind : "all";
  const visible = new Set(
    entries
      .filter(
        (entry) =>
          (activeKind === "all" || entry.kind === activeKind) &&
          (!status || entry.tone === status),
      )
      .map((entry) => entry.id),
  );
  const filtered = activeKind !== "all" || status !== null;
  const counts = STATUS_SUMMARY.map((item) => ({
    ...item,
    count: entries.filter((entry) => entry.tone === item.tone).length,
  })).filter((item) => item.count > 0);
  const show = <T extends { id: string }>(items: T[]) =>
    items.filter((item) => visible.has(item.id));

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
            className="mb-3 flex flex-wrap items-center gap-1.5"
          >
            <span className="text-xs text-text-secondary flex items-center mt-1">
              전체 {entries.length}
            </span>
            {counts.map(({ tone, label, count }) => (
              <button
                key={tone}
                type="button"
                aria-pressed={status === tone}
                title={`${label} 상태만 보기`}
                onClick={() => setStatus(status === tone ? null : tone)}
                className={cn(
                  "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                  status && status !== tone && "opacity-40",
                )}
              >
                <Badge tone={tone}>
                  {label} {count}
                </Badge>
              </button>
            ))}
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
      <ScrollFade
        className="flex flex-col gap-2 -mr-2 min-h-0 flex-auto pr-2"
        fade={10}
      >
        {!equipment ? (
          <p className="text-xs text-text-secondary">
            장비 상태를 준비하고 있습니다.
          </p>
        ) : (
          <>
            {(!filtered || show(equipment.robots).length > 0) && (
              <RobotStatusSection robots={show(equipment.robots)} />
            )}

            {(!filtered || show(equipment.agents).length > 0) && (
              <AMRStatusSection agents={show(equipment.agents)} />
            )}

            <StaticEquipmentSection
              title="컨베이어"
              objects={show(
                objects.filter((object) => object.kind === "conveyor"),
              )}
            />

            <StaticEquipmentSection
              title="스캐너"
              objects={show(
                objects.filter((object) => object.kind === "scanner"),
              )}
            />

            {filtered && visible.size === 0 && (
              <p className="mt-2 text-[11px] text-text-secondary">
                조건에 맞는 장비가 없습니다.
              </p>
            )}
          </>
        )}
      </ScrollFade>
    </Panel>
  );
}
