import { useSceneStore } from "@/stores/useSceneStore";
import { cn } from "@/lib/style";

type Check = { ok: boolean; required: boolean; label: string; hint: string };

/** AGV 행동 준비 상태: 하차 위치는 필수, 경로·Rack_m 연결은 권장. */
export default function AgvBehaviorChecklist({ id }: { id: string }) {
  const stopPoints = useSceneStore((state) => state.settings[id]?.stopPoints);
  const path = useSceneStore((state) => state.settings[id]?.agvPath);
  const links = useSceneStore((state) => state.links);
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);

  const hasDrop = (stopPoints ?? []).some((p) => p.role === "rackDrop");
  const hasPath = (path ?? []).length > 0;
  const hasRack = links.some((link) => {
    if (link.type !== "store" || link.from !== id) return false;
    const rack = objects.find((o) => o.id === link.to);
    return rack?.kind === "rack" && settings[rack.id]?.rackType === "mobile";
  });

  const checks: Check[] = [
    { ok: hasDrop, required: true, label: "Rack_m 하차 위치 지정", hint: "없으면 만재 Rack_m을 옮기지 않습니다" },
    { ok: hasPath, required: false, label: "경로 연결", hint: "없으면 자동 경로로 운반합니다" },
    { ok: hasRack, required: false, label: "담당 Rack_m 연결", hint: "없으면 같은 구역 Rack_m만 견인합니다" },
  ];

  const ready = checks.filter((c) => c.required).every((c) => c.ok);

  return (
    <div className="mt-2 rounded-[3px] border border-white/10 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold text-text-primary">행동 준비</span>
        <span className={ready ? "text-emerald-400" : "text-amber-400"}>{ready ? "작동 가능" : "필수 항목 필요"}</span>
      </div>
      <ul className="space-y-1">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-1.5 text-[11px]">
            <span aria-hidden className={cn("mt-0.5 w-3 shrink-0 text-center", c.ok ? "text-emerald-400" : "text-text-secondary")}>
              {c.ok ? "✓" : "○"}
            </span>
            <span className="min-w-0">
              <span className="text-text-primary">{c.label}</span>
              <span className="text-text-secondary"> · {c.required ? "필수" : "권장"}{c.ok ? "" : ` · ${c.hint}`}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
