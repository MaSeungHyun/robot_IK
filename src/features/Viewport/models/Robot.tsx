import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { useEffect, useId, useMemo, useRef, type RefObject } from "react";
import type { Mesh } from "three";
import type { Transfer, JointAngleRef } from "../../../types/robot";
import type { RobotController } from "../../../interface/RobotController";
import { SuctionRobotController } from "../../robots/SuctionRobotController";
import robot from "@/assets/models/robot.glb?url";

type Props = ThreeElements["group"] & {
  robotId?: string;
  running: boolean;
  jobs: RefObject<Transfer[]>;
  onProgress: (completed: number, status: string) => void;
  geometryScale?: number;
  pickupRadius?: number;
  jointAnglesRef?: JointAngleRef;
};

export default function Robot({
  robotId, jobs, running, onProgress, geometryScale = 1,
  jointAnglesRef, pickupRadius, ...props
}: Props) {
  const instanceId = useId();
  const { scene } = useGLTF(robot);
  const model = useMemo(() => {
    const copy = scene.clone(true);
    if (geometryScale !== 1)
      copy.traverse((node) => {
        node.position.multiplyScalar(geometryScale);
        if ("geometry" in node) {
          const mesh = node as Mesh;
          mesh.geometry = mesh.geometry.clone();
          mesh.geometry.scale(geometryScale, geometryScale, geometryScale);
        }
      });
    return copy;
  }, [scene, geometryScale]);

  const controller = useRef<RobotController | null>(null);
  const inputs = useRef({ jobs, onProgress });
  useEffect(() => {
    const instance = new SuctionRobotController({
      id: robotId ?? instanceId, model, geometryScale, pickupRadius,
      getJobs: () => inputs.current.jobs.current,
      onProgress: (count, status) => inputs.current.onProgress(count, status),
    });
    controller.current = instance;
    return () => { instance.dispose(); controller.current = null; };
  }, [model, geometryScale, robotId, instanceId, pickupRadius]);

  useFrame((_, delta) => {
    inputs.current = { jobs, onProgress };
    const instance = controller.current;
    if (!instance) return;
    if (running) instance.start(); else instance.pause();
    instance.update(delta);
    if (jointAnglesRef) jointAnglesRef.current = instance.getJointAngles();
  });
  return (
    <group {...props}>
      <primitive object={model} />
    </group>
  );
}
