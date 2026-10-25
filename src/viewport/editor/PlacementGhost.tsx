import type { EquipmentKind } from "@/types/layout";
import ConveyorGhost from "@/viewport/editor/ConveyorGhost";
import ModelGhost from "@/viewport/editor/ModelGhost";
import ProceduralGhost from "@/viewport/editor/ProceduralGhost";
import { DOOR_CONFIG } from "@/constants/door";
import { useSceneStore } from "@/stores/useSceneStore";
import { isForkliftRole } from "@/types/layout";
import { AMR_DECK } from "@/constants/cycle";

export default function PlacementGhost({ kind }: { kind: EquipmentKind }) {
  // The forklift asset is an AMR with amrRole "forklift": preview its own model, not the AMR.
  const forklift = useSceneStore((state) => kind === "amr" && isForkliftRole(state.pendingPreset?.amrRole));
  // AGV (amrRole "agv") and Rack_m (rackType "mobile") are procedural models, not AMR.glb / Rack.glb.
  const procedural = useSceneStore((state) =>
    kind === "amr" && state.pendingPreset?.amrRole === "agv" ? "agv" : kind === "rack" && state.pendingPreset?.rackType === "mobile" ? "rack-mobile" : null);
  // A shuttle AMR is placed with its pallet mounted (store add()): show it on the deck.
  const shuttle = useSceneStore((state) => kind === "amr" && state.pendingPreset?.amrRole === "shuttle");
  return (
    <group>
      {shuttle && (
        <group position={[0, AMR_DECK, 0]}>
          <ModelGhost kind="pallet" />
        </group>
      )}
      {kind === "conveyor" ? (
        <ConveyorGhost />
      ) : kind === "floor" ? (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.008, 0]}
          raycast={() => { }}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            color="#02dfef"
            transparent
            opacity={0.3}
            depthWrite={false}
          />
        </mesh>
      ) : kind === "door" ? (
        <mesh position={[0, DOOR_CONFIG.height / 2, 0]} raycast={() => { }}>
          <boxGeometry args={[DOOR_CONFIG.width, DOOR_CONFIG.height, 0.1]} />
          <meshBasicMaterial color="#02dfef" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ) : kind === "dock" ? (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.008, 0]}
          raycast={() => { }}
        >
          <planeGeometry args={[1.3, 1.3]} />
          <meshBasicMaterial
            color="#02dfef"
            transparent
            opacity={0.35}
            depthWrite={false}
          />
        </mesh>
      ) : procedural ? (
        <ProceduralGhost kind={procedural} />
      ) : (
        <ModelGhost kind={forklift ? "forklift" : kind} />
      )}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.012, 0]}
        raycast={() => { }}
      >
        <ringGeometry args={[0.12, 0.15, 32]} />
        <meshBasicMaterial
          color="#02dfef"
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
