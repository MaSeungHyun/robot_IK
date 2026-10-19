import { useEffect, useMemo } from "react";
import type { ConveyorTurn } from "@/types/layout";
import { conveyorTemplate } from "@/features/conveyor/conveyorTemplate";
import { translucentClone } from "@/utils/three/translucentClone";

export default function ConveyorGhost({ turn = "straight" }: { turn?: ConveyorTurn }) {
  const ghost = useMemo(() => translucentClone(conveyorTemplate(turn)), [turn]);

  useEffect(() => ghost.dispose, [ghost]);

  return <primitive object={ghost.model} dispose={null} />;
}
