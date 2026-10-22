import type { Object3D } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import AMR from "@/objects/amr/AMR";
import type { RackAMRController } from "@/domain/amr/RackAMRController";
import { minimapLive } from "@/viewport/minimap/minimapBridge";
import { clickEquipment, inspectEquipment, playHover } from "@/viewport/selection/inspectEquipment";

/**
 * Dedicated rack-unloading AMR (temporary stand-in; replace this component and RackAMRController together).
 * The carrier is moved by the simulator; a pallet taken from a rack rides attached to it.
 */
export default function RackAMR({ id, controller }: { id: string; controller: RackAMRController }) {
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
      <AMR route={controller} />
    </primitive>
  );
}
