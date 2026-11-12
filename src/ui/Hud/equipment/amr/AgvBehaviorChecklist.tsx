import { useSceneStore } from "@/stores/useSceneStore";
import type { ReadinessCheck } from "@/domain/cycle/shuttleReadiness";
import ReadinessChecklist from "@/ui/Hud/equipment/amr/ReadinessChecklist";

/** AGV 행동 준비 상태: 하차 위치는 필수, 경로·Rack_m 연결은 권장. */
export default function AgvBehaviorChecklist({ id }: { id: string }) {
  const stopPoints = useSceneStore((state) => state.settings[id]?.stopPoints);
  const path = useSceneStore((state) => state.settings[id]?.agvPath);
  const links = useSceneStore((state) => state.links);
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);

  const hasPath = (path ?? []).length > 0;
  const mobileRacks = (agvId: string) => links.filter((link) => {
    if (link.type !== "store" || link.from !== agvId) return false;
    const rack = objects.find((o) => o.id === link.to);
    return rack?.kind === "rack" && settings[rack.id]?.rackType === "mobile";
  }).map((link) => link.to);
  const mine = mobileRacks(id);
  const hasRack = mine.length > 0;
  const ownDrop = (agvId: string) => (settings[agvId]?.stopPoints ?? []).some((p) => p.role === "rackDrop");
  // An AGV linked to the same Rack_m as an AGV with a 하차 위치 uses that drop (PalletCycle.agvDrop).
  const sharedDrop = objects.some((o) => o.id !== id && o.kind === "amr" && settings[o.id]?.amrRole === "agv" && ownDrop(o.id)
    && mobileRacks(o.id).some((rackId) => mine.includes(rackId)));
  const hasDrop = (stopPoints ?? []).some((p) => p.role === "rackDrop") || sharedDrop;

  const checks: ReadinessCheck[] = [
    { ok: hasDrop, required: true, label: "Rack_m 하차 위치 지정", hint: "없으면 만재 Rack_m을 옮기지 않습니다 (같은 Rack_m에 연결된 다른 AGV의 하차 위치도 사용)" },
    { ok: hasPath, required: false, label: "경로 연결", hint: "없으면 자동 경로로 운반합니다" },
    { ok: hasRack, required: false, label: "담당 Rack_m 연결", hint: "없으면 같은 구역 Rack_m만 견인합니다" },
  ];

  return <ReadinessChecklist checks={checks} />;
}
