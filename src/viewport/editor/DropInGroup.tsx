import { useRef } from "react";
import type { ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { dropInSchedule, dropInState } from "@/viewport/editor/dropIn";

/**
 * Inner render group of one equipment for the auto-layout drop-in (see dropIn.ts). Only this group's
 * position.y moves; instanced meshes follow through SceneInstances (their matrices are re-read from
 * matrixWorld, so only the y translation changes). Hidden until its staggered start = fade-in step for
 * instanced batches (they share materials, so no per-instance alpha).
 */
export default function DropInGroup({ id, children }: { id: string; children: ReactNode }) {
  const group = useRef<Group>(null);
  useFrame(() => {
    const node = group.current;
    if (!node) return;
    const state = dropInState(id, performance.now());
    if (!state) {
      if (node.position.y !== 0 || !node.visible) { node.position.y = 0; node.visible = true; }
      return;
    }
    node.position.y = state.y;
    node.visible = state.opacity > 0;
    if (state.done) dropInSchedule.delete(id);
  });
  return <group ref={group}>{children}</group>;
}
