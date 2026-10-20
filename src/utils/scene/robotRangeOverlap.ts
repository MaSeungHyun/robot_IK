import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import type { EquipmentSettings, SceneEquipment } from "@/types/layout";

export type RobotRangeOverlapPair = {
  first: SceneEquipment;
  second: SceneEquipment;
};

export function getOverlappingRobotPairs(
  objects: SceneEquipment[],
  settings: Record<string, EquipmentSettings>,
): RobotRangeOverlapPair[] {
  const robots = objects.filter((object) => object.kind === "robot");
  const pairs: RobotRangeOverlapPair[] = [];

  for (let i = 0; i < robots.length; i++) {
    const first = robots[i];
    const firstReach = settings[first.id]?.reach ?? SIMULATOR_CONFIG.reach;

    for (let j = i + 1; j < robots.length; j++) {
      const second = robots[j];
      const secondReach = settings[second.id]?.reach ?? SIMULATOR_CONFIG.reach;
      const distanceSquared = (first.x - second.x) ** 2 + (first.z - second.z) ** 2;
      const combinedReach = firstReach + secondReach;

      if (distanceSquared < combinedReach ** 2) {
        pairs.push({ first, second });
      }
    }
  }

  return pairs;
}

export function getOverlappingRobotIds(
  objects: SceneEquipment[],
  settings: Record<string, EquipmentSettings>,
): Set<string> {
  const overlappingIds = new Set<string>();

  for (const { first, second } of getOverlappingRobotPairs(objects, settings)) {
    overlappingIds.add(first.id);
    overlappingIds.add(second.id);
  }

  return overlappingIds;
}
