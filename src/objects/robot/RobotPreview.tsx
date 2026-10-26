import { useGLTF } from "@/lib/three/gltfLoader";
import { useMemo } from "react";
import { robotArmUrl as robotUrl } from "@/constants/modelAssets";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { poseRobotHome } from "@/domain/robot/ik/joints";

export default function RobotPreview() {
  const { scene } = useGLTF(robotUrl);
  const model = useMemo(() => poseRobotHome(scene.clone(true)), [scene]);
  useInstanceModel(model);
  return <primitive object={model} />;
}
