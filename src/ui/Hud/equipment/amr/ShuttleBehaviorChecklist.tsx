import { useMemo } from "react";
import { useSceneStore } from "@/stores/useSceneStore";
import { shuttleReadiness } from "@/domain/cycle/shuttleReadiness";
import ReadinessChecklist from "@/ui/Hud/equipment/amr/ReadinessChecklist";

/** 셔틀 AMR 행동 준비 상태: 팔레트와 사용할 교체 지게차는 필수, 전용 연결은 권장. */
export default function ShuttleBehaviorChecklist({ id }: { id: string }) {
  const links = useSceneStore((state) => state.links);
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);
  const checks = useMemo(() => shuttleReadiness(id, objects, settings, links), [id, objects, settings, links]);

  return <ReadinessChecklist checks={checks} />;
}
