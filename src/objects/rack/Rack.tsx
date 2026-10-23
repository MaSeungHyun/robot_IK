import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import rackUrl from "@/assets/models/Rack.glb?url";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";

export default function Rack() {
  const { scene } = useGLTF(rackUrl);
  const model = useMemo(() => scene.clone(true), [scene]);
  useInstanceModel(model);
  return <primitive object={model} dispose={null} />;
}
