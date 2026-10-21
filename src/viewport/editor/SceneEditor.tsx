import { Suspense } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSceneStore } from "@/stores/useSceneStore";
import EditableObject from "@/viewport/editor/EditableObject";
import ModelErrorBoundary from "@/viewport/models/ModelErrorBoundary";
import PlacementFloor from "@/viewport/editor/PlacementFloor";
import ModalTransform from "@/viewport/editor/ModalTransform";
import useRobotRangeOverlaps from "@/hooks/robot/useRobotRangeOverlaps";

export default function SceneEditor() {
  const ids = useSceneStore(useShallow((state) => state.objects.map((object) => object.id)));
  const overlappingIds = useRobotRangeOverlaps();

  return (
    <>
      <PlacementFloor />
      <ModalTransform />

      {ids.map((id) => (
        <ModelErrorBoundary key={id} label={`설비 ${id}`}>
          <Suspense fallback={null}>
            <EditableObject id={id} overlapping={overlappingIds.has(id)} />
          </Suspense>
        </ModelErrorBoundary>
      ))}
    </>
  );
}
