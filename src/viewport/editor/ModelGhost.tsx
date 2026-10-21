import scannerUrl from "@/assets/models/scanner.glb?url";
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import robotUrl from "@/assets/models/robot.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";
import amrUrl from "@/assets/models/amr.glb?url";
import rackUrl from "@/assets/models/rack.glb?url";
import { buildModelGhost, type GhostModelKind } from "@/viewport/editor/ghostModels";

export default function ModelGhost({ kind }: { kind: GhostModelKind }) {
  const { scene } = useGLTF(
    kind === "robot" ? robotUrl : kind === "pallet" ? palletUrl : kind === "scanner" ? scannerUrl : kind === "rack" ? rackUrl : amrUrl,
  );
  const ghost = useMemo(() => buildModelGhost(kind, scene), [scene, kind]);

  useEffect(() => ghost.dispose, [ghost]);

  return <primitive object={ghost.model} dispose={null} />;
}
