import { clickEquipment, inspectEquipment, playHover } from "@/viewport/selection/inspectEquipment";
import { memo, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import type { FactoryRobot, FactorySimulator } from "@/domain/simulation/FactorySimulator";
import Robot from "@/objects/robot/Robot";
import type { EquipmentSettings } from "@/types/layout";
import type { RobotTransferMode } from "@/types/robot";

type Props = {
  robot: FactoryRobot;
  world: FactorySimulator;
  running: boolean;
  transferMode: RobotTransferMode;
  settings: EquipmentSettings;
};

const FactoryArm = memo(function FactoryArm({ robot, world, running, transferMode, settings }: Props) {
  const jobs = useRef(robot.jobs);

  function handleSelect(event: ThreeEvent<MouseEvent>) {
    clickEquipment(event, robot.object.id);
  }

  return (
    <Robot
      robotId={robot.object.id}
      position={[robot.object.x, 0, robot.object.z]}
      rotation={[0, robot.object.yaw, 0]}
      pickupRadius={SIMULATOR_CONFIG.reach}
      transferMode={transferMode}
      simulationSpeed={settings.speed}
      jobs={jobs}
      running={running && settings.enabled}
      onProgress={(count, status) => world.robotProgress(robot, count, status)}
      {...playHover}
      onClick={handleSelect}
      onDoubleClick={(event) => inspectEquipment(event, robot.object.id)}
    />
  );
});

export default FactoryArm;
