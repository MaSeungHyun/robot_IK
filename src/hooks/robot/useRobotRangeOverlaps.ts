import { useMemo } from "react";
import { useSceneStore } from "@/stores/useSceneStore";
import { useLivePoseStore } from "@/stores/useLivePoseStore";
import { getOverlappingRobotIds } from "@/domain/robot/robotRangeOverlap";

/** Overlapping robot ranges, using live (uncommitted) drag positions where present. */
export default function useRobotRangeOverlaps() {
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);
  const live = useLivePoseStore((state) => state.poses);

  return useMemo(() => {
    const ids = Object.keys(live);
    const current = ids.length
      ? objects.map((object) => (live[object.id] ? { ...object, ...live[object.id] } : object))
      : objects;
    return getOverlappingRobotIds(current, settings);
  }, [objects, settings, live]);
}
