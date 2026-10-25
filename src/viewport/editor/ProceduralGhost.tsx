import { useEffect, useMemo } from "react";
import { translucentClone } from "@/lib/three/translucentClone";
import { createAgvModel, createRackMobileModel } from "@/lib/three/cycleModels";

export type ProceduralGhostKind = "agv" | "rack-mobile";

/** Translucent placement preview of a procedural pallet-cycle model (AGV, Rack_m). */
export default function ProceduralGhost({ kind }: { kind: ProceduralGhostKind }) {
  const ghost = useMemo(() => translucentClone(kind === "agv" ? createAgvModel().root : createRackMobileModel()), [kind]);
  useEffect(() => ghost.dispose, [ghost]);
  return <primitive object={ghost.model} dispose={null} />;
}
