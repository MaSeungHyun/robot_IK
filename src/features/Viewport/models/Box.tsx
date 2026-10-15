import { useGLTF } from "@react-three/drei";
import box from "@/assets/models/box.glb?url";
import { useMemo, type Ref } from "react";
import type { Group } from "three";
import type { ThreeElements } from "@react-three/fiber";

type BoxProps = ThreeElements["group"] & { ref?: Ref<Group> };
export default function Box({ ref, ...props }: BoxProps) {
  const { scene } = useGLTF(box);
  const model = useMemo(() => scene.clone(true), [scene]);
  return <group ref={ref} {...props}><primitive object={model} /></group>;
}
