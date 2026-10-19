import { useMemo } from "react";
import { useSceneStore } from "@/stores/useSceneStore";
import { getOverlappingRobotIds } from "@/utils/scene/robotRangeOverlap";

export default function useRobotRangeOverlaps() {
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);

  return useMemo(() => getOverlappingRobotIds(objects, settings), [objects, settings]);
}
