import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import robotUrl from "@/assets/models/RobotArm.glb?url";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { poseRobotHome } from "@/domain/robot/ik/joints";

export default function RobotPreview() {
  const { scene } = useGLTF(robotUrl);
  const model = useMemo(() => poseRobotHome(scene.clone(true)), [scene]);
  useInstanceModel(model);
  return <primitive object={model} />;
}
