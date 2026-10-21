import { useEffect, useMemo } from "react";
import type { ConveyorTurn } from "@/types/layout";
import { buildConveyorGhost } from "@/viewport/editor/ghostModels";

export default function ConveyorGhost({ turn = "straight" }: { turn?: ConveyorTurn }) {
  const ghost = useMemo(() => buildConveyorGhost(turn), [turn]);

  useEffect(() => ghost.dispose, [ghost]);

  return <primitive object={ghost.model} dispose={null} />;
}
