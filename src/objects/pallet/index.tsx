import { useGLTF } from "@/lib/three/gltfLoader";
import { palletUrl as pallet } from "@/constants/modelAssets";
import { useMemo } from "react";
import type { ThreeElements } from "@react-three/fiber";
import { createPalletModel } from "@/lib/three/palletModel";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { PALLET_STACKING } from "@/constants/simulation";

/** Same turn the simulator applies to every pallet, so the editor preview shows the fork openings where they will be. */
const PALLET_TURN = (PALLET_STACKING.palletYawDegrees * Math.PI) / 180;

export default function Pallet(props: ThreeElements["group"]) {
  const { scene } = useGLTF(pallet);
  const model = useMemo(() => createPalletModel(scene), [scene]);
  useInstanceModel(model);

  return (
    <group {...props}>
      <group rotation-y={PALLET_TURN}>
        <primitive object={model} />
      </group>
    </group>
  );
}
