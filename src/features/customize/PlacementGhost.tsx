import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { Box3, Group, Mesh, Vector3 } from "three";
import type { Material } from "three";
import type { ConveyorTurn, EquipmentKind } from "../../types/layout";
import { createUnitPallet } from "@/utils/three/modelNormalization";
import { CUSTOMIZE_CONFIG as C } from "../../constants/customize";
import { STREAM_CONFIG } from "../../constants/simulation";
import { AMR_CONFIG } from "../../constants/amr";
import { conveyorTemplate } from "@/features/conveyor/conveyorTemplate";
import robotUrl from "@/assets/models/robot.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";
import amrUrl from "@/assets/models/amr.glb?url";

function translucentClone(source: Group) {
  const model = source.clone(true),
    materials: Material[] = [];
  model.traverse((node) => {
    if (node instanceof Mesh) {
      const ghost = (material: Material) => {
        const copy = material.clone();
        copy.transparent = true;
        copy.opacity = 0.35;
        copy.depthWrite = false;
        materials.push(copy);
        return copy;
      };
      node.material = Array.isArray(node.material)
        ? node.material.map(ghost)
        : ghost(node.material);
      node.visible = true;
      node.raycast = () => {};
      node.castShadow = false;
    }
  });
  return {
    model,
    dispose: () => materials.forEach((material) => material.dispose()),
  };
}
function ModelGhost({ kind }: { kind: "robot" | "pallet" | "amr" }) {
  const { scene } = useGLTF(
    kind === "robot" ? robotUrl : kind === "pallet" ? palletUrl : amrUrl,
  );
  const ghost = useMemo(() => {
    let model: Group;
    if (kind === "pallet") {
      model = createUnitPallet(scene);
      model.scale.set(
        STREAM_CONFIG.palletWidth,
        STREAM_CONFIG.palletHeight,
        STREAM_CONFIG.palletDepth,
      );
    } else {
      model = scene.clone(true);
      if (kind === "robot") model.scale.multiplyScalar(C.robotScale);
      else {
        const bounds = new Box3().setFromObject(model),
          size = bounds.getSize(new Vector3());
        model.scale.multiplyScalar(
          AMR_CONFIG.bodyWidth / Math.max(size.x, size.z),
        );
        bounds.setFromObject(model);
        const center = bounds.getCenter(new Vector3());
        model.position.sub(new Vector3(center.x, bounds.min.y, center.z));
      }
    }
    return translucentClone(model);
  }, [scene, kind]);
  useEffect(() => ghost.dispose, [ghost]);
  return <primitive object={ghost.model} dispose={null} />;
}
export function ConveyorGhost({ turn = "straight" }: { turn?: ConveyorTurn }) {
  const ghost = useMemo(() => translucentClone(conveyorTemplate(turn)), [turn]);
  useEffect(() => ghost.dispose, [ghost]);
  return <primitive object={ghost.model} dispose={null} />;
}
export default function PlacementGhost({ kind }: { kind: EquipmentKind }) {
  return (
    <group>
      {kind === "conveyor" ? (
        <ConveyorGhost />
      ) : kind === "dock" ? (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.008, 0]}
          raycast={() => {}}
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
        raycast={() => {}}
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
