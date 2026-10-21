import FloorRoom from "@/objects/room/FloorRoom";
import { useEffect } from "react";
import { clickEquipment, inspectEquipment, playHover, resetCursor } from "@/viewport/selection/inspectEquipment";
import Scanner from "@/objects/scanner/Scanner";
import type { ThreeEvent } from "@react-three/fiber";
import type { Object3D } from "three";
import FactoryArm from "@/viewport/simulation/FactoryArm";
import useFactoryRuntime from "@/viewport/simulation/useFactoryRuntime";
import type { SimulatorRunProps } from "@/viewport/simulation/types";
import AMR from "@/objects/amr/AMR";
import ConveyorBelt from "@/objects/conveyor/ConveyorBelt";
import Dock from "@/objects/dock/Dock";
import Rack from "@/objects/rack/Rack";

// Play mode: a click opens the object's Details (see clickEquipment).
const handleEquipmentSelect = clickEquipment;

function handleCargoSelect(event: ThreeEvent<MouseEvent>, inspect = false) {
  let node: Object3D | null = event.object;
  while (node && !node.userData.sceneId) node = node.parent;

  if (!node) return;

  if (inspect) inspectEquipment(event, node.userData.sceneId);
  else handleEquipmentSelect(event, node.userData.sceneId);
}

export default function FactoryRun(props: SimulatorRunProps) {
  const { world, objects, settings } = useFactoryRuntime(props);
  useEffect(() => resetCursor, []);
  const staticObjects = objects.filter((object) => object.kind === "conveyor" || object.kind === "dock" || object.kind === "rack" || object.kind === "scanner" || object.kind === "floor");

  return (
    <>
      <primitive object={world.root} {...playHover} onClick={(event: ThreeEvent<MouseEvent>) => handleCargoSelect(event)} onDoubleClick={(event: ThreeEvent<MouseEvent>) => handleCargoSelect(event, true)} />

      {world.robots.map((robot) => (
        <FactoryArm
          key={robot.object.id}
          robot={robot}
          world={world}
          running={props.running}
          transferMode={props.transferMode}
          settings={settings[robot.object.id]}
        />
      ))}

      {world.agents.map((agent) => (
        <primitive key={agent.object.id} object={agent.dispatch.carrier} {...playHover} onClick={(event: ThreeEvent<MouseEvent>) => handleEquipmentSelect(event, agent.object.id)} onDoubleClick={(event: ThreeEvent<MouseEvent>) => inspectEquipment(event, agent.object.id)}>
          <AMR route={agent.dispatch} />
        </primitive>
      ))}

      {staticObjects.map((object) => object.kind === "floor" ? (
        // Floors/walls are scenery while simulating: not selectable, hoverable or trackable.
        <group key={object.id} position={[object.x, 0, object.z]} rotation={[0, object.yaw, 0]}>
          <FloorRoom {...(object.floor ?? { width: 1, depth: 1, wallHeight: 0 })} interactive={false} />
        </group>
      ) : (
        <group
          key={object.id}
          userData={{ sceneId: object.id }}
          position={[object.x, 0, object.z]}
          rotation={[0, object.yaw, 0]}
          {...playHover}
          onClick={(event) => handleEquipmentSelect(event, object.id)}
          onDoubleClick={(event) => inspectEquipment(event, object.id)}
        >
          {object.kind === "conveyor" ? <ConveyorBelt entity={object} /> : object.kind === "scanner" ? <Scanner entity={object} inspection={world.inspection} /> : object.kind === "rack" ? <Rack /> : <Dock id={object.id} />}
        </group>
      ))}
    </>
  );
}
