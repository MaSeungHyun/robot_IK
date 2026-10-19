import { useMemo } from "react";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { useInstanceModel } from "@/features/Viewport/instancing/useInstanceModel";

const dockGeometry = new PlaneGeometry(1.3, 1.3);
const dockMaterial = new MeshBasicMaterial({ color: "#075985", transparent: true, opacity: 0.75 });

export default function Dock() {
  const model = useMemo(() => {
    const group = new Group(), mesh = new Mesh(dockGeometry, dockMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.004;
    group.add(mesh);
    return group;
  }, []);
  useInstanceModel(model);
  return <primitive object={model} dispose={null} />;
}
