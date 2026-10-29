import { scanTunnelUrl as scannerUrl, robotArmUrl as robotUrl, palletUrl, amrUrl, rackUrl, forkliftUrl, railConditionUrl, transferForkliftUrl } from "@/constants/modelAssets";
import { useGLTF } from "@/lib/three/gltfLoader";
import { useEffect, useMemo } from "react";
import { buildModelGhost, type GhostModelKind } from "@/viewport/editor/ghostModels";

export default function ModelGhost({ kind }: { kind: GhostModelKind }) {
  const { scene } = useGLTF(
    kind === "robot" ? robotUrl : kind === "pallet" ? palletUrl : kind === "scanner" ? scannerUrl : kind === "rack" ? rackUrl : kind === "forklift" ? forkliftUrl : kind === "rail" ? railConditionUrl ?? amrUrl : kind === "transfer" ? transferForkliftUrl ?? amrUrl : amrUrl,
  );
  const ghost = useMemo(() => buildModelGhost(kind, scene), [scene, kind]);

  useEffect(() => ghost.dispose, [ghost]);

  return <primitive object={ghost.model} dispose={null} />;
}
