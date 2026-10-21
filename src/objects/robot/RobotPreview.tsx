import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import robotUrl from "@/assets/models/robot.glb?url";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";

export default function RobotPreview() {
  const { scene } = useGLTF(robotUrl);
  const model = useMemo(() => scene.clone(true), [scene]);
  useInstanceModel(model);
  return <group scale={SIMULATOR_CONFIG.robotScale}><primitive object={model} /></group>;
}
