import type { Object3D } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import AMR, { AMRPath } from "@/objects/amr/AMR";
import ForkliftModel from "@/objects/forklift/ForkliftModel";
import type { CycleVehicle } from "@/domain/cycle/CycleVehicle";
import { minimapLive } from "@/viewport/minimap/minimapBridge";
import { clickEquipment, inspectEquipment, playHover } from "@/viewport/selection/inspectEquipment";

type Props = { id: string; kind: "shuttle" | "agv" | "forklift"; vehicle: CycleVehicle };

/** Pallet-cycle vehicle: the carrier (moved by PalletCycle) plus its GLB body; the AGV body is procedural (already on the carrier). */
export default function CycleVehicleView({ id, kind, vehicle }: Props) {
  return (
    <primitive
      object={vehicle.carrier}
      ref={(carrier: Object3D | null) => {
        if (carrier) minimapLive.set(id, carrier);
        else minimapLive.delete(id);
      }}
      {...playHover}
      onClick={(event: ThreeEvent<MouseEvent>) => clickEquipment(event, id)}
      onDoubleClick={(event: ThreeEvent<MouseEvent>) => inspectEquipment(event, id)}
    >
      {kind === "shuttle" && <AMR />}
      {kind === "forklift" && <ForkliftModel fork={vehicle.fork ?? undefined} />}
      <AMRPath route={vehicle} />
    </primitive>
  );
}
