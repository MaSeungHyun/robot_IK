import useRobotJointReadings from "@/hooks/useRobotJointReadings";
import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { useEffect, useId, useMemo, useRef, type RefObject } from "react";
import type { BufferGeometry, Mesh } from "three";
import type {
  Transfer,
  JointAngleRef,
  RobotTransferMode,
} from "../../../types/robot";
import type { RobotController } from "../../../interface/RobotController";
import { SuctionRobotController } from "../../robots/SuctionRobotController";
import robot from "@/assets/models/robot.glb?url";
import { useInstanceModel } from "@/features/Viewport/instancing/useInstanceModel";
import { useSimulationStore } from "../../../stores/useSimulationStore";
import { simulationDelta } from "@/utils/simulation/simulationTime";
import { planningScheduler } from "@/utils/robot/planningScheduler";

const scaledGeometries = new WeakMap<
  BufferGeometry,
  Map<number, BufferGeometry>
>();
function geometryAtScale(source: BufferGeometry, scale: number) {
  let scales = scaledGeometries.get(source);
  if (!scales) {
    scales = new Map();
    scaledGeometries.set(source, scales);
  }
  let geometry = scales.get(scale);
  if (!geometry) {
    geometry = source.clone();
    geometry.scale(scale, scale, scale);
    scales.set(scale, geometry);
  }
  return geometry;
}

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
    do {
      const step = Math.min(remaining, 0.05);
      instance.update(step);
      remaining -= step;
    } while (remaining > 1e-9);
    if (jointAnglesRef) jointAnglesRef.current = instance.getJointAngles();
  });

  return (
    <group {...props} userData={{ ...props.userData, sceneId: robotId }}>
      <primitive object={model} />
    </group>
  );
}
