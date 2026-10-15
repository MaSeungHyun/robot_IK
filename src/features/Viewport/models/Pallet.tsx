import { useGLTF } from "@react-three/drei";
import pallet from "@/assets/models/pallet.glb?url";
import { useMemo } from "react";
import type { ThreeElements } from "@react-three/fiber";

export default function Pallet(props: ThreeElements["group"]) {
  const { scene } = useGLTF(pallet);
  const model = useMemo(() => scene.clone(true), [scene]);
  return <group {...props}><primitive object={model} /></group>;
}
