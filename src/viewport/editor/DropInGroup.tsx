import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Box3 } from "three";
import type { Group, Material, Mesh, Object3D } from "three";
import { DROP_IN, dropInMaterial, dropInSchedule, dropInState } from "@/viewport/editor/dropIn";
import type { DropInFrame } from "@/viewport/editor/dropIn";

type Saved = { material: Material | Material[]; onBeforeRender: Object3D["onBeforeRender"] };
const box = new Box3();
const u = dropInMaterial.uniforms;

/**
 * Inner render group of one equipment for the auto-layout drop-in (see dropIn.ts). Only this group's
 * position.y moves; instanced meshes follow through SceneInstances. Hidden until its staggered start.
 * While warping, its meshes use the shared hologram material; each mesh's onBeforeRender writes this object's
 * uniforms (bbox height, band, flash) so one program serves every object. Originals restored when done / unmount.
 */
export default function DropInGroup({ id, children }: { id: string; children: ReactNode }) {
  const group = useRef<Group>(null);
  const originals = useRef<Map<Mesh, Saved> | null>(null);
  const frame = useRef<DropInFrame | null>(null);
  const range = useRef({ minY: 0, height: 1 });
  const restore = () => {
    for (const [mesh, saved] of originals.current ?? []) { mesh.material = saved.material; mesh.onBeforeRender = saved.onBeforeRender; }
    originals.current = null;
  };
  useEffect(() => restore, []);
  useFrame(() => {
    const node = group.current;
    if (!node) return;
    if (dropInSchedule.has(id) && !originals.current) {
      const swap = new Map<Mesh, Saved>();
      if (DROP_IN.materialSwap) {
        node.position.y = 0;
        node.updateWorldMatrix(true, true);
        box.setFromObject(node);
        range.current = { minY: box.isEmpty() ? 0 : box.min.y, height: box.isEmpty() ? 1 : Math.max(0.05, box.max.y - box.min.y) };
        const write = () => {
          const f = frame.current;
          if (!f) return;
          u.uMinY.value = range.current.minY + f.y;
          u.uHeight.value = range.current.height;
          u.uBand.value = f.band;
          u.uFlash.value = f.flash;
          u.uFade.value = f.fade;
          dropInMaterial.uniformsNeedUpdate = true;
        };
        node.traverse((child) => {
          const mesh = child as Mesh;
          if (mesh.isMesh && !(mesh as { isInstancedMesh?: boolean }).isInstancedMesh) {
            swap.set(mesh, { material: mesh.material, onBeforeRender: mesh.onBeforeRender });
            mesh.material = dropInMaterial;
            mesh.onBeforeRender = write;
          }
        });
      }
      originals.current = swap;
    }
    const state = dropInState(id, performance.now(), !!originals.current?.size);
    frame.current = state;
    if (!state) {
      if (originals.current) restore();
      if (node.position.y !== 0 || !node.visible) { node.position.y = 0; node.visible = true; }
      return;
    }
    node.position.y = state.y;
    node.visible = state.visible;
    if (state.done) { dropInSchedule.delete(id); restore(); }
  });
  return <group ref={group}>{children}</group>;
}
