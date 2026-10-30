import { clickEquipment, inspectEquipment, playHover } from "@/viewport/selection/inspectEquipment";
import { memo, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import type { FactoryRobot, FactorySimulator } from "@/domain/simulation/FactorySimulator";
import Robot from "@/objects/robot/Robot";
import RobotPedestal from "@/objects/robot/RobotPedestal";
import { pedestalYawOffset, robotElevation } from "@/domain/layout/robotPedestals";
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

  const pedestal = settings.robotPedestal;
  const y = robotElevation(robot.object, pedestal);
  return (
    <>
    {pedestal && pedestal !== "none" && (
      <group position={[robot.object.x, y, robot.object.z]} rotation={[0, robot.object.yaw + pedestalYawOffset(settings), 0]}><RobotPedestal kind={pedestal} /></group>
    )}
    <Robot
      robotId={robot.object.id}
      position={[robot.object.x, y, robot.object.z]}
      rotation={[0, robot.object.yaw, 0]}
      pickupRadius={settings.reach ?? SIMULATOR_CONFIG.reach}
      transferMode={transferMode}
      simulationSpeed={settings.speed}
      jobs={jobs}
      running={running && settings.enabled}
      onProgress={(count, status) => world.robotProgress(robot, count, status)}
      {...playHover}
      onClick={handleSelect}
      onDoubleClick={(event) => inspectEquipment(event, robot.object.id)}
    />
    </>
  );
});

export default FactoryArm;
