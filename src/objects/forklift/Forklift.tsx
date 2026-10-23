import type { Object3D } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { AMRPath } from "@/objects/amr/AMR";
import ForkliftModel from "@/objects/forklift/ForkliftModel";
import type { ForkliftController } from "@/domain/amr/ForkliftController";
import { minimapLive } from "@/viewport/minimap/minimapBridge";
import { clickEquipment, inspectEquipment, playHover } from "@/viewport/selection/inspectEquipment";

/**
 * Forklift driven by ForkliftController. The carrier is moved by the simulator; the controller's
 * fork group (a child of the carrier) carries the pallet, and the model's fork node follows its height.
 */
export default function Forklift({ id, controller }: { id: string; controller: ForkliftController }) {
  return (
    <primitive
      object={controller.carrier}
      ref={(carrier: Object3D | null) => {
        if (carrier) minimapLive.set(id, carrier);
        else minimapLive.delete(id);
      }}
      {...playHover}
      onClick={(event: ThreeEvent<MouseEvent>) => clickEquipment(event, id)}
      onDoubleClick={(event: ThreeEvent<MouseEvent>) => inspectEquipment(event, id)}
    >
      <ForkliftModel fork={controller.fork} />
      <AMRPath route={controller} />
    </primitive>
  );
}