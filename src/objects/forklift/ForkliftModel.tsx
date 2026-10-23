import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import type { Object3D } from "three";
import forkliftUrl from "@/assets/models/Forklift.glb?url";
import { FORKLIFT_MODEL } from "@/constants/modelPoints.generated";

/** GLTFLoader strips "." from node names (`Forklift.Fork` loads as `ForkliftFork`): compare alphanumerics only. */
const key = (name: string) => name.replace(/[^a-z0-9]/gi, "").toLowerCase();

/** Forklift.glb as authored (no scaling). With `fork`, the model's fork node follows that group's height. */
export default function ForkliftModel({ fork }: { fork?: Object3D }) {
  const { scene } = useGLTF(forkliftUrl);
  const model = useMemo(() => scene.clone(true), [scene]);
  const forkNode = useRef<Object3D | null>(null);
  useEffect(() => {
    let found: Object3D | null = null;
    model.traverse((node) => {
      if (!found && key(node.name) === key(FORKLIFT_MODEL.forkNode)) found = node;
    });
    if (!found) console.warn(`Forklift.glb: fork node "${FORKLIFT_MODEL.forkNode}" not found; the fork will not move.`);
    forkNode.current = found;
  }, [model]);
  useFrame(() => {
    const node = forkNode.current;
    if (fork && node) node.position.y = fork.position.y;
  });
  // Marked as the measured model for the tracking ring (the carrier also holds the fork group).
  return <primitive object={model} dispose={null} userData={{ trackingModel: true }} />;
}