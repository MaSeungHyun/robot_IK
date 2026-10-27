import { useMemo } from "react";
import { Box3, DoubleSide, Mesh } from "three";
import type { BufferAttribute, MeshStandardMaterial } from "three";
import { useGLTF } from "@/lib/three/gltfLoader";
import type { DoorPanel } from "./doorModel";

/** door.glb is optional (falls back to the procedural shutter when the file is absent). */
const urls = import.meta.glob("/src/assets/models/door.glb", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const doorUrl: string | undefined = Object.values(urls)[0];

function useGlbPanel(): DoorPanel | null {
  const { scene } = useGLTF(doorUrl!);
  return useMemo(() => {
    let mesh: Mesh | undefined;
    scene.traverse((node) => { if (!mesh && node instanceof Mesh) mesh = node; });
    if (!mesh) return null;
    const geometry = mesh.geometry.clone();
    const box = new Box3().setFromBufferAttribute(geometry.getAttribute("position") as BufferAttribute);
    const size = box.max.clone().sub(box.min);
    // The glb plane lies in XY on the far end wall: centre it, turn it to face the interior (+Z) and
    // hang it from its top edge. Native size is kept (no fitting); the opening uses width/height below.
    geometry.translate(-(box.min.x + box.max.x) / 2, -box.max.y, -(box.min.z + box.max.z) / 2);
    geometry.rotateY(Math.PI);
    const material = (mesh.material as MeshStandardMaterial).clone();
    material.side = DoubleSide;
    return { geometry, material, width: size.x, height: size.y };
  }, [scene]);
}

/** The door.glb panel, or null (procedural fallback). Hook choice is fixed at module load. */
export const useDoorPanel: () => DoorPanel | null = doorUrl ? useGlbPanel : () => null;