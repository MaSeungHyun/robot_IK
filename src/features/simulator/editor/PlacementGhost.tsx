import type { EquipmentKind } from "@/types/layout";
import ConveyorGhost from "@/features/conveyor/ConveyorGhost";
import ModelGhost from "@/features/Viewport/models/ModelGhost";

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
