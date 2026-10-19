import { Suspense } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSceneStore } from "@/stores/useSceneStore";
import EditableObject from "@/features/simulator/editor/EditableObject";
import PlacementFloor from "@/features/simulator/editor/PlacementFloor";
import useRobotRangeOverlaps from "@/features/simulator/hooks/useRobotRangeOverlaps";

export default function SceneEditor() {
  const ids = useSceneStore(useShallow((state) => state.objects.map((object) => object.id)));
  const overlappingIds = useRobotRangeOverlaps();

  return (
    <>
      <PlacementFloor />

      {ids.map((id) => (
        <Suspense key={id} fallback={null}>
          <EditableObject id={id} overlapping={overlappingIds.has(id)} />
        </Suspense>
      ))}
    </>
  );
}
