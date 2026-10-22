import type { Object3D } from "three";
import { minimapLive } from "@/viewport/minimap/minimapBridge";
import FloorRoom from "@/objects/room/FloorRoom";
import { useEffect } from "react";
import { clickBox, clickEquipment, inspectEquipment, playHover, resetCursor } from "@/viewport/selection/inspectEquipment";
import Scanner from "@/objects/scanner/Scanner";
import type { ThreeEvent } from "@react-three/fiber";
import { cargoBoxId, sceneOwner } from "@/viewport/scene/sceneOwner";
import FactoryArm from "@/viewport/simulation/FactoryArm";
import useFactoryRuntime from "@/viewport/simulation/useFactoryRuntime";
import type { SimulatorRunProps } from "@/viewport/simulation/types";
import AMR from "@/objects/amr/AMR";
import ConveyorBelt from "@/objects/conveyor/ConveyorBelt";
import Dock from "@/objects/dock/Dock";
import Rack from "@/objects/rack/Rack";
import Door from "@/objects/door/Door";
import RackAMR from "@/objects/amr/RackAMR";

// Play mode: a click opens the object's Details (see clickEquipment).
const handleEquipmentSelect = clickEquipment;

function handleCargoSelect(event: ThreeEvent<MouseEvent>, inspect = false) {
  const box = cargoBoxId(event.object);
  if (box) {
    if (!inspect) clickBox(event, box);
    return;
  }
  const id = sceneOwner(event.object);
  if (!id) return;

  if (inspect) inspectEquipment(event, id);
  else handleEquipmentSelect(event, id);
}

export default function FactoryRun(props: SimulatorRunProps) {
  const { world, objects, settings } = useFactoryRuntime(props);
  useEffect(() => resetCursor, []);
  const staticObjects = objects.filter((object) => object.kind === "conveyor" || object.kind === "dock" || object.kind === "rack" || object.kind === "scanner" || object.kind === "floor" || object.kind === "door");

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
        <primitive key={agent.object.id} object={agent.dispatch.carrier} ref={(carrier: Object3D | null) => { if (carrier) minimapLive.set(agent.object.id, carrier); else minimapLive.delete(agent.object.id); }} {...playHover} onClick={(event: ThreeEvent<MouseEvent>) => handleEquipmentSelect(event, agent.object.id)} onDoubleClick={(event: ThreeEvent<MouseEvent>) => inspectEquipment(event, agent.object.id)}>
          <AMR route={agent.dispatch} />
        </primitive>
      ))}

      {world.rackAgents.map((agent) => <RackAMR key={agent.object.id} id={agent.object.id} controller={agent.controller} />)}

      {staticObjects.map((object) => object.kind === "floor" ? (
        // Floors/walls are scenery while simulating: not selectable, hoverable or trackable.
        <group key={object.id} position={[object.x, 0, object.z]} rotation={[0, object.yaw, 0]}>
          <FloorRoom {...(object.floor ?? { width: 1, depth: 1, wallHeight: 0 })} interactive={false} pose={object} />
        </group>
      ) : (
        <group
          key={object.id}
          // Racks, docks and conveyors never move while running (scanners and doors animate, so they stay dynamic).
          userData={{ sceneId: object.id, instanceStatic: object.kind !== "scanner" && object.kind !== "door" }}
          position={[object.x, 0, object.z]}
          rotation={[0, object.yaw, 0]}
          {...playHover}
          onClick={(event) => handleEquipmentSelect(event, object.id)}
          onDoubleClick={(event) => inspectEquipment(event, object.id)}
        >
          {object.kind === "conveyor" ? <ConveyorBelt entity={object} /> : object.kind === "scanner" ? <Scanner entity={object} inspection={world.inspection} /> : object.kind === "rack" ? <Rack /> : object.kind === "door" ? <Door id={object.id} simOpening={() => world.doorOpening(object.id)} /> : <Dock id={object.id} />}
        </group>
      ))}
    </>
  );
}
