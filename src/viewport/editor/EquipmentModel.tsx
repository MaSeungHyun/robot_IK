import Scanner from "@/objects/scanner/Scanner";
import AMR from "@/objects/amr/AMR";
import ForkliftModel from "@/objects/forklift/ForkliftModel";
import { useSceneStore } from "@/stores/useSceneStore";
import ConveyorBelt from "@/objects/conveyor/ConveyorBelt";
import Dock from "@/objects/dock/Dock";
import Rack from "@/objects/rack/Rack";
import { AMR_DECK, CYCLE_CONFIG } from "@/constants/cycle";
import { STREAM_CONFIG } from "@/constants/simulation";
import { AgvBody, RackMobile } from "@/objects/rack/RackMobile";
import Door from "@/objects/door/Door";
import Pallet from "@/objects/pallet/index";
import RobotPreview from "@/objects/robot/RobotPreview";
import FloorRoom from "@/objects/room/FloorRoom";
import { isForkliftRole, type SceneEquipment } from "@/types/layout";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import ConveyorExtensionControls from "@/viewport/editor/ConveyorExtensionControls";

export default function EquipmentModel({ object }: { object: SceneEquipment }) {
  switch (object.kind) {
    case "robot":
      return <RobotPreview />;

    case "pallet":
      return <PalletModel id={object.id} />;

    case "conveyor":
      return (
        <>
          <ConveyorBelt entity={object} />
          <ConveyorExtensionControls entity={object} />
        </>
      );

    case "amr":
      return <AMRModel id={object.id} />;

    case "scanner":
      return (
        <>
          <Scanner entity={object} />
          <ConveyorExtensionControls entity={object} />
        </>
      );

    case "dock":
      return <DockModel id={object.id} />;

    case "rack":
      return <RackModel id={object.id} />;

    case "floor":
      return <EditorFloor object={object} />;

    case "door":
      return <Door id={object.id} />;

  }
}

/** Floors, walls and roof are not link targets: they ignore pointer rays while link mode is on. */
function EditorFloor({ object }: { object: SceneEquipment }) {
  const linking = useLinkModeStore((state) => state.active);
  return <FloorRoom {...(object.floor ?? { width: 1, depth: 1, wallHeight: 0 })} interactive={!linking} pose={object} />;
}

/** Forklift-role AMRs show the forklift model; AGV-role AMRs the lifting AGV. */
function AMRModel({ id }: { id: string }) {
  const role = useSceneStore((state) => state.settings[id]?.amrRole);
  if (isForkliftRole(role)) return <ForkliftModel />;
  return role === "agv" ? <AgvBody /> : <AMR />;
}

/** A pallet mounted on a shuttle AMR (mountedOn) sits on the AMR's AMR_point seat. */
function PalletModel({ id }: { id: string }) {
  const mounted = useSceneStore((state) => Boolean(state.settings[id]?.mountedOn));
  return mounted ? <group position={[0, AMR_DECK, 0]}><Pallet /></group> : <Pallet />;
}

/** 빈 팔레트 적치장 (dockRole "palletSource"): previews the initial stack Play places on it (CYCLE_CONFIG.sourceStack). */
function DockModel({ id }: { id: string }) {
  const source = useSceneStore((state) => state.settings[id]?.dockRole === "palletSource");
  return (
    <>
      <Dock id={id} />
      {source && Array.from({ length: CYCLE_CONFIG.sourceStack }, (_, i) => <Pallet key={i} position={[0, i * STREAM_CONFIG.palletHeight, 0]} />)}
    </>
  );
}

/** Rack_m (rackType "mobile") is its own model, distinct from Rack.glb. */
function RackModel({ id }: { id: string }) {
  const mobile = useSceneStore((state) => state.settings[id]?.rackType === "mobile");
  return mobile ? <RackMobile /> : <Rack />;
}
