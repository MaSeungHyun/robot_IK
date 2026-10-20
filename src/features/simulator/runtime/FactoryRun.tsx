import FloorRoom from "@/features/Viewport/models/FloorRoom";
import { inspectEquipment } from "@/utils/scene/inspectEquipment";
import Scanner from "@/features/Viewport/models/Scanner";
import type { ThreeEvent } from "@react-three/fiber";
import type { Object3D } from "three";
import FactoryArm from "@/features/simulator/runtime/FactoryArm";
import useFactoryRuntime from "@/features/simulator/runtime/useFactoryRuntime";
import type { SimulatorRunProps } from "@/features/simulator/runtime/types";
import AMR from "@/features/Viewport/models/AMR";
import ConveyorBelt from "@/features/Viewport/models/ConveyorBelt";
import Dock from "@/features/Viewport/models/Dock";
import { useSceneStore } from "@/stores/useSceneStore";
import { isSelectionClick } from "@/utils/scene/isSelectionClick";

function handleEquipmentSelect(event: ThreeEvent<MouseEvent>, id: string) {
  if (!isSelectionClick(event)) return;

  event.stopPropagation();
  useSceneStore.getState().select(id);
}

function handleCargoSelect(event: ThreeEvent<MouseEvent>, inspect = false) {
  let node: Object3D | null = event.object;
  while (node && !node.userData.sceneId) node = node.parent;

  if (!node) return;

  if (inspect) inspectEquipment(event, node.userData.sceneId);
  else handleEquipmentSelect(event, node.userData.sceneId);
}

export default function FactoryRun(props: SimulatorRunProps) {
  const { world, objects, settings } = useFactoryRuntime(props);
  const staticObjects = objects.filter((object) => object.kind === "conveyor" || object.kind === "dock" || object.kind === "scanner" || object.kind === "floor");

  return (
    <>
      <primitive object={world.root} onClick={(event: ThreeEvent<MouseEvent>) => handleCargoSelect(event)} onDoubleClick={(event: ThreeEvent<MouseEvent>) => handleCargoSelect(event, true)} />

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
        <primitive key={agent.object.id} object={agent.dispatch.carrier} onClick={(event: ThreeEvent<MouseEvent>) => handleEquipmentSelect(event, agent.object.id)} onDoubleClick={(event: ThreeEvent<MouseEvent>) => inspectEquipment(event, agent.object.id)}>
          <AMR route={agent.dispatch} />
        </primitive>
      ))}

      {staticObjects.map((object) => (
        <group
          key={object.id}
          userData={{ sceneId: object.id }}
          position={[object.x, 0, object.z]}
          rotation={[0, object.yaw, 0]}
          onClick={(event) => handleEquipmentSelect(event, object.id)}
          onDoubleClick={(event) => inspectEquipment(event, object.id)}
        >
          {object.kind === "conveyor" ? <ConveyorBelt entity={object} /> : object.kind === "scanner" ? <Scanner entity={object} inspection={world.inspection} /> : object.kind === "floor" ? <FloorRoom {...(object.floor ?? { width: 1, depth: 1, wallHeight: 0 })} /> : <Dock />}
        </group>
      ))}
    </>
  );
}
