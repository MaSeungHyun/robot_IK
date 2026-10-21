import { useGLTF } from "@react-three/drei";
import pallet from "@/assets/models/pallet.glb?url";
import { useMemo } from "react";
import type { ThreeElements } from "@react-three/fiber";
import { createPalletModel } from "@/lib/three/palletModel";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";

export default function Pallet(props: ThreeElements["group"]) {
  const { scene } = useGLTF(pallet);
  const model = useMemo(() => createPalletModel(scene), [scene]);
  useInstanceModel(model);

  return (
    <group {...props}>
      <primitive object={model} />
    </group>
  );
}
