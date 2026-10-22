import Scanner from "@/objects/scanner/Scanner";
import AMR from "@/objects/amr/AMR";
import ConveyorBelt from "@/objects/conveyor/ConveyorBelt";
import Dock from "@/objects/dock/Dock";
import Rack from "@/objects/rack/Rack";
import Pallet from "@/objects/pallet/index";
import RobotPreview from "@/objects/robot/RobotPreview";
import FloorRoom from "@/objects/room/FloorRoom";
import type { SceneEquipment } from "@/types/layout";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import ConveyorExtensionControls from "@/viewport/editor/ConveyorExtensionControls";

export default function EquipmentModel({ object }: { object: SceneEquipment }) {
  switch (object.kind) {
    case "robot":
      return <RobotPreview />;

    case "pallet":
      return <Pallet />;

    case "conveyor":
      return (
        <>
          <ConveyorBelt entity={object} />
          <ConveyorExtensionControls entity={object} />
        </>
      );

    case "amr":
      return <AMR />;

    case "scanner":
      return <Scanner entity={object} />;

    case "dock":
      return <Dock id={object.id} />;

    case "rack":
      return <Rack />;

    case "floor":
      return <EditorFloor object={object} />;

  }
}

/** Floors, walls and roof are not link targets: they ignore pointer rays while link mode is on. */
function EditorFloor({ object }: { object: SceneEquipment }) {
  const linking = useLinkModeStore((state) => state.active);
  return <FloorRoom {...(object.floor ?? { width: 1, depth: 1, wallHeight: 0 })} interactive={!linking} />;
}