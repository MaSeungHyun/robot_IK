import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { MODEL } from "@/viewport/models/modelUrls";
import type { ConveyorTurn } from "@/types/layout";
import { buildConveyorGhost } from "@/viewport/editor/ghostModels";

export default function ConveyorGhost({ turn = "straight" }: { turn?: ConveyorTurn }) {
  const { scene: rail } = useGLTF(MODEL.rail);
  const ghost = useMemo(() => buildConveyorGhost(turn, rail), [turn, rail]);

  useEffect(() => ghost.dispose, [ghost]);

  return <primitive object={ghost.model} dispose={null} />;
}
