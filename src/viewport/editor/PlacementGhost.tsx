import type { EquipmentKind } from "@/types/layout";
import ConveyorGhost from "@/viewport/editor/ConveyorGhost";
import ModelGhost from "@/viewport/editor/ModelGhost";
import { DOOR_CONFIG } from "@/constants/door";

export default function PlacementGhost({ kind }: { kind: EquipmentKind }) {
  return (
    <group>
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
            color="#38bdf8"
            transparent
            opacity={0.3}
            depthWrite={false}
          />
        </mesh>
      ) : kind === "door" ? (
        <mesh position={[0, DOOR_CONFIG.height / 2, 0]} raycast={() => { }}>
          <boxGeometry args={[DOOR_CONFIG.width, DOOR_CONFIG.height, 0.1]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ) : kind === "dock" ? (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.008, 0]}
          raycast={() => { }}
        >
          <planeGeometry args={[1.3, 1.3]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.35}
            depthWrite={false}
          />
        </mesh>
      ) : (
        <ModelGhost kind={kind} />
      )}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.012, 0]}
        raycast={() => { }}
      >
        <ringGeometry args={[0.12, 0.15, 32]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
