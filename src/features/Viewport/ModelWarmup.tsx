import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Group, InstancedMesh, Mesh, type Material, type Texture } from "three";
import amrUrl from "@/assets/models/amr.glb?url";
import boxUrl from "@/assets/models/box.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";
import robotUrl from "@/assets/models/robot.glb?url";
import scannerUrl from "@/assets/models/scanner.glb?url";

const MODEL_URLS = [robotUrl, palletUrl, boxUrl, amrUrl, scannerUrl];
// Parse and decode every GLB at app load, long before Play mounts the factory.
for (const url of MODEL_URLS) useGLTF.preload(url);

const warmed = new WeakSet<object>();

/**
 * Compiles the shader programs of every equipment material (plain and instanced variants,
 * with this scene's lights) and uploads their textures once, in the background, so the first
 * Play frame does not stall on shader compilation or texture upload. Renders nothing.
 */
export default function ModelWarmup() {
  const models = useGLTF(MODEL_URLS);
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    if (warmed.has(gl)) return;
    warmed.add(gl);
    const root = new Group();
    const textures = new Set<Texture>();
    for (const { scene: model } of models) {
      root.add(model.clone(true));
      model.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        // SceneInstances draws equipment as InstancedMesh, a separate program variant.
        root.add(new InstancedMesh(node.geometry, node.material, 1));
        const materials: Material[] = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials)
          for (const value of Object.values(material))
            if (value && (value as Texture).isTexture) textures.add(value as Texture);
      });
    }
    let cancelled = false;
    gl.compileAsync(root, camera, scene)
      .then(() => {
        if (cancelled) return;
        for (const texture of textures) gl.initTexture(texture);
      })
      .catch(() => {
        // Warm-up is best effort: the first render compiles anything left over.
      })
      .finally(() => {
        for (const child of root.children) if (child instanceof InstancedMesh) child.dispose();
      });
    return () => {
      cancelled = true;
    };
  }, [models, gl, scene, camera]);
  return null;
}
