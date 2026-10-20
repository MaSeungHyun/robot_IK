import Scanner from "@/features/Viewport/models/Scanner";
import AMR from "@/features/Viewport/models/AMR";
import ConveyorBelt from "@/features/Viewport/models/ConveyorBelt";
import Dock from "@/features/Viewport/models/Dock";
import Pallet from "@/features/Viewport/models/Pallet";
import RobotPreview from "@/features/Viewport/models/RobotPreview";
import FloorRoom from "@/features/Viewport/models/FloorRoom";
import type { SceneEquipment } from "@/types/layout";

export default function EquipmentModel({ object }: { object: SceneEquipment }) {
  switch (object.kind) {
    case "robot":
      return <RobotPreview />;

    case "pallet":
      return <Pallet />;

    case "conveyor":
      return <ConveyorBelt entity={object} />;

    case "amr":
      return <AMR />;

    case "scanner":
      return <Scanner entity={object} />;

    case "dock":
      return <Dock />;

    case "floor":
      return <FloorRoom {...(object.floor ?? { width: 1, depth: 1, wallHeight: 0 })} />;

  }
}

