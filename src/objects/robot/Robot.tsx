import useRobotJointReadings from "@/hooks/robot/useRobotJointReadings";
import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { useEffect, useId, useMemo, useRef, type RefObject } from "react";
import type { Mesh } from "three";
import { geometryAtScale } from "@/lib/three/geometryAtScale";
import type {
  Transfer,
  JointAngleRef,
  RobotTransferMode,
} from "../../types/robot";
import type { RobotController } from "@/domain/robot/RobotController";
import { SuctionRobotController } from "@/domain/robot/SuctionRobotController";
import robot from "@/assets/models/robot.glb?url";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { useSimulationStore } from "../../stores/useSimulationStore";
import { simulationDelta } from "@/domain/simulation/simulationTime";
import { planningScheduler } from "@/domain/robot/ik/planningScheduler";
import { profileEnd, profileStart } from "@/lib/profiler/frameProfiler";


type Props = ThreeElements["group"] & {
  robotId?: string;
  running: boolean;
  jobs: RefObject<Transfer[]>;
  onProgress: (completed: number, status: string) => void;
  geometryScale?: number;
  pickupRadius?: number;
  transferMode?: RobotTransferMode;
  jointAnglesRef?: JointAngleRef;
  simulationSpeed?: number;
};

export default function Robot({
  robotId,
  jobs,
  running,
  onProgress,
  geometryScale = 1,
  jointAnglesRef,
  pickupRadius,
  transferMode,
  simulationSpeed = 1,
  ...props
}: Props) {
  const playbackSpeed = useSimulationStore((state) => state.speed);
  const instanceId = useId();
  const { scene } = useGLTF(robot);
  const model = useMemo(() => {
    const copy = scene.clone(true);
    if (geometryScale !== 1)
      copy.traverse((node) => {
        node.position.multiplyScalar(geometryScale);
        if ("geometry" in node) {
          const mesh = node as Mesh;
          mesh.geometry = geometryAtScale(mesh.geometry, geometryScale);
        }
      });
    return copy;
  }, [scene, geometryScale]);
  useInstanceModel(model);

  const controller = useRef<RobotController | null>(null);
  const inputs = useRef({ jobs, onProgress });
  useEffect(() => {
    const instance = new SuctionRobotController({
      id: robotId ?? instanceId,
      model,
      geometryScale,
      pickupRadius,
      transferMode,
      getJobs: () => inputs.current.jobs.current,
      onProgress: (count, status) => inputs.current.onProgress(count, status),
    });
    controller.current = instance;
    return () => {
      instance.dispose();
      controller.current = null;
    };
  }, [model, geometryScale, robotId, instanceId, pickupRadius, transferMode]);

  useRobotJointReadings(robotId, controller);

  useFrame((state, delta) => {
    inputs.current = { jobs, onProgress };
    const instance = controller.current;
    if (!instance) return;
    if (running) instance.start();
    else instance.pause();
    // Shared per-frame IK budget, consumed once across all sub-steps of this frame.
    instance.setPlanningBudget?.(planningScheduler.budget(instance.id, state.clock.elapsedTime));
    let remaining = simulationDelta(delta, playbackSpeed, simulationSpeed);
    if (!Number.isFinite(remaining)) remaining = 0;
    // Defensive cap for extreme speed multipliers (normal speeds need far fewer sub-steps).
    let steps = 0;
    const robotStart = profileStart();
    do {
      const step = Math.min(remaining, 0.05);
      instance.update(step);
      remaining -= step;
    } while (remaining > 1e-9 && ++steps < 400);
    profileEnd("robots", robotStart);
    if (jointAnglesRef) jointAnglesRef.current = instance.getJointAngles();
  });

  return (
    <group {...props} userData={{ ...props.userData, sceneId: robotId }}>
      <primitive object={model} />
    </group>
  );
}
