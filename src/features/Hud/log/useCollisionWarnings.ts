import { useMemo } from "react";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { useSceneStore } from "@/stores/useSceneStore";
import { getOverlappingRobotPairs } from "@/utils/scene/robotRangeOverlap";

export type CollisionWarning = {
  id: string;
  message: string;
};

export default function useCollisionWarnings(): CollisionWarning[] {
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);

  return useMemo<CollisionWarning[]>(() => {
    const entries: CollisionWarning[] = [];

    for (const { first, second } of getOverlappingRobotPairs(
      objects,
      settings,
    )) {
      entries.push({
        id: `robot-overlap:${first.id}:${second.id}`,
        message: `로봇 범위 겹침\n${first.name} ↔ ${second.name} · 충돌 위험`,
      });
    }

    const robots = objects.filter((object) => object.kind === "robot");
    const scanners = objects.filter((object) => object.kind === "scanner");

    for (const robot of robots) {
      const reach = settings[robot.id]?.reach ?? SIMULATOR_CONFIG.reach;
      for (const scanner of scanners) {
        const distanceSquared =
          (robot.x - scanner.x) ** 2 + (robot.z - scanner.z) ** 2;
        if (distanceSquared < reach ** 2) {
          entries.push({
            id: `scanner-proximity:${robot.id}:${scanner.id}`,
            message: `스캐너 근접\n${robot.name} ↔ ${scanner.name} · 충돌 위험`,
          });
        }
      }
    }

    return entries;
  }, [objects, settings]);
}