import { useMemo } from "react";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { useSceneStore } from "@/stores/useSceneStore";

const dockGeometry = new PlaneGeometry(1.3, 1.3);
const dockMaterial = new MeshBasicMaterial({
  color: "#075985",
  transparent: true,
  opacity: 0.75,
});
// Shared tint for docks that accept defect pallets only (--color-fault).
const defectDockMaterial = new MeshBasicMaterial({
  color: "#f94258",
  transparent: true,
  opacity: 0.75,
});

/** Dock tint meshes (both grades) for the startup shader warm-up. */
export const dockWarmupModel = () => {
  const group = new Group();
  for (const material of [dockMaterial, defectDockMaterial]) group.add(new Mesh(dockGeometry, material));
  return group;
};

export default function Dock({ id }: { id?: string }) {
  const defect = useSceneStore(
    (state) => id !== undefined && state.settings[id]?.acceptGrade === "defect",
  );
  // A new model per grade re-registers with the instanced scene, which batches by material.
  const model = useMemo(() => {
    const group = new Group(),
      mesh = new Mesh(dockGeometry, defect ? defectDockMaterial : dockMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.004;

    group.add(mesh);
    return group;
  }, [defect]);
  useInstanceModel(model, true);
  return <primitive object={model} dispose={null} />;
}
