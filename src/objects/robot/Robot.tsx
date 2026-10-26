import useRobotJointReadings from "@/hooks/robot/useRobotJointReadings";
import { useGLTF } from "@/lib/three/gltfLoader";
import type { ThreeElements } from "@react-three/fiber";
import { useEffect, useId, useMemo, useRef, type RefObject } from "react";
import type {
  Transfer,
  JointAngleRef,
  RobotTransferMode,
} from "../../types/robot";
import type { RobotController } from "@/domain/robot/RobotController";
import { SuctionRobotController } from "@/domain/robot/SuctionRobotController";
import { robotArmUrl as robot } from "@/constants/modelAssets";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { simulationClock } from "@/domain/simulation/simulationClock";
import { planningScheduler } from "@/domain/robot/ik/planningScheduler";
import { MOTION } from "@/constants/simulation";
import { poseRobotHome } from "@/domain/robot/ik/joints";


type Props = ThreeElements["group"] & {
  robotId?: string;
  running: boolean;
  jobs: RefObject<Transfer[]>;
  onProgress: (completed: number, status: string) => void;
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
  jointAnglesRef,
  pickupRadius,
  transferMode,
  simulationSpeed = 1,
  ...props
}: Props) {
  const instanceId = useId();
  const { scene } = useGLTF(robot);
  // Used exactly as authored (no scaling).
  const model = useMemo(() => poseRobotHome(scene.clone(true)), [scene]);
  useInstanceModel(model);

  const controller = useRef<RobotController | null>(null);
  const inputs = useRef({ jobs, onProgress, running, simulationSpeed, jointAnglesRef });
  // Latest props for the clock callbacks (they run outside React, once per frame / per step).
  useEffect(() => { inputs.current = { jobs, onProgress, running, simulationSpeed, jointAnglesRef }; });
  useEffect(() => {
    const instance = new SuctionRobotController({
      id: robotId ?? instanceId,
      model,
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
  }, [model, robotId, instanceId, pickupRadius, transferMode]);

  useRobotJointReadings(robotId, controller);

  // Advanced by the shared fixed-step simulation clock (same steps and dt as boxes/belts/AMRs).
  useEffect(() => simulationClock.register({
    beginFrame: (frameKey) => {
      const instance = controller.current;
      if (!instance) return;
      if (inputs.current.running) instance.start();
      else instance.pause();
      // Shared per-frame IK budget, consumed once across all steps of this frame.
      instance.setPlanningBudget?.(planningScheduler.budget(instance.id, frameKey));
    },
    step: (dt) => {
      const instance = controller.current;
      if (!instance) return;
      // Equipment speed multiplier; the controller clamps single updates to MOTION.maxDelta, so split.
      let remaining = dt * inputs.current.simulationSpeed;
      if (!Number.isFinite(remaining) || remaining <= 0) { instance.update(0); return; }
      while (remaining > 1e-9) {
        const step = Math.min(remaining, MOTION.maxDelta);
        instance.update(step);
        remaining -= step;
      }
    },
    endFrame: () => {
      const instance = controller.current, ref = inputs.current.jointAnglesRef;
      if (instance && ref) ref.current = instance.getJointAngles();
    },
  }), []);

  return (
    <group {...props} userData={{ ...props.userData, sceneId: robotId }}>
      <primitive object={model} />
    </group>
  );
}
