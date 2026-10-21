import { useMemo } from "react";
import { useSceneStore } from "@/stores/useSceneStore";
import { getOverlappingRobotIds } from "@/domain/robot/robotRangeOverlap";

export default function useRobotRangeOverlaps() {
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);

  return useMemo(() => getOverlappingRobotIds(objects, settings), [objects, settings]);
}
