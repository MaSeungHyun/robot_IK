import { useMemo } from "react";
import { useGLTF } from "@/lib/three/gltfLoader";
import { rackUrl } from "@/constants/modelAssets";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";

export default function Rack() {
  const { scene } = useGLTF(rackUrl);
  const model = useMemo(() => scene.clone(true), [scene]);
  useInstanceModel(model, true);
  return <primitive object={model} dispose={null} />;
}
