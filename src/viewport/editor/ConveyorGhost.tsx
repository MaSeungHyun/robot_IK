import { useEffect, useMemo } from "react";
import { useGLTF } from "@/lib/three/gltfLoader";
import { MODEL } from "@/viewport/models/modelUrls";
import type { ConveyorTurn } from "@/types/layout";
import { buildConveyorGhost } from "@/viewport/editor/ghostModels";
import { railInOutModel, railInOutUrl } from "@/objects/conveyor/glbConveyors";
import { translucentClone } from "@/lib/three/translucentClone";
import { useSceneStore } from "@/stores/useSceneStore";

export default function ConveyorGhost({ turn = "straight" }: { turn?: ConveyorTurn }) {
  // A pending 입하/출하 conveyor previews rail_in_out.glb exactly as ConveyorBelt draws it once placed.
  const inOut = useSceneStore((state) => {
    const role = state.pending === "conveyor" ? state.pendingPreset?.conveyorRole : undefined;
    return turn === "straight" && (role === "inbound" || role === "outbound" || role === "ship");
  });
  return inOut && railInOutUrl ? <RailInOutGhost url={railInOutUrl} /> : <RailGhost turn={turn} />;
}

function RailGhost({ turn }: { turn: ConveyorTurn }) {
  const { scene: rail } = useGLTF(MODEL.rail);
  const ghost = useMemo(() => buildConveyorGhost(turn, rail), [turn, rail]);
  useEffect(() => ghost.dispose, [ghost]);
  return <primitive object={ghost.model} dispose={null} />;
}

function RailInOutGhost({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const ghost = useMemo(() => translucentClone(railInOutModel(scene)), [scene]);
  useEffect(() => ghost.dispose, [ghost]);
  return <primitive object={ghost.model} dispose={null} />;
}
