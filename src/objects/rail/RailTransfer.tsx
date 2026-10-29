import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Object3D } from "three";
import { useGLTF } from "@/lib/three/gltfLoader";
import { railConditionUrl, transferForkliftUrl } from "@/constants/modelAssets";
import { RAIL_CONFIG, TRANSFER_CONFIG } from "@/constants/railTransfer";
import { STREAM_CONFIG } from "@/constants/simulation";

if (railConditionUrl) useGLTF.preload(railConditionUrl);
if (transferForkliftUrl) useGLTF.preload(transferForkliftUrl);

/** rail_condition.glb as authored (origin = rail centre on the floor); a plain box when the GLB is missing. */
export function Rail() {
  if (!railConditionUrl)
    return (
      <mesh position={[0, RAIL_CONFIG.point.y / 2, RAIL_CONFIG.centerZ]}>
        <boxGeometry args={[RAIL_CONFIG.halfLength * 2, RAIL_CONFIG.point.y, RAIL_CONFIG.halfWidth * 2]} />
        <meshStandardMaterial color="#8a8f96" />
      </mesh>
    );
  return <RailModel url={railConditionUrl} />;
}

function RailModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const model = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={model} dispose={null} />;
}

export type TransferView = { down: number; entry: number; side: -1 | 1 } | null;

/**
 * Transfer_Forklift.glb as authored; the fork node only moves up / down with the simulation, carrying two stoppers
 * on the rail-axis sides of the pallet: the entry one (rail side) drops while a pallet rolls on, the far one stays up.
 */
export function Transfer({ view }: { view?: () => TransferView }) {
  if (!transferForkliftUrl)
    return (
      <mesh position={[-0.05, 2.1, 0.9]}>
        <boxGeometry args={[1.9, 4.2, 3.3]} />
        <meshStandardMaterial color="#d9a400" />
      </mesh>
    );
  return <TransferModel url={transferForkliftUrl} view={view} />;
}

function TransferModel({ url, view }: { url: string; view?: () => TransferView }) {
  const { scene } = useGLTF(url);
  const model = useMemo(() => scene.clone(true), [scene]);
  const fork = useMemo<Object3D | undefined>(() => model.getObjectByName(TRANSFER_CONFIG.forkNode), [model]);
  const base = useMemo(() => fork?.position.clone(), [fork]);
  const carriage = useRef<Group>(null);
  const stoppers = useRef<(Object3D | null)[]>([]);
  useEffect(() => () => { if (fork && base) fork.position.copy(base); }, [fork, base]);
  const s = TRANSFER_CONFIG.stopper, p = TRANSFER_CONFIG.point, gap = STREAM_CONFIG.palletWidth / 2 + s.width / 2 + 0.02;
  useFrame(() => {
    const v = view?.() ?? null;
    const dy = -(v?.down ?? 0) * TRANSFER_CONFIG.downY;
    if (fork && base) fork.position.set(base.x, base.y + dy, base.z);
    carriage.current?.position.set(0, dy, 0);
    // Index 0 = −x stopper, 1 = +x. The rail sits on +x of a left-end (side −1) lift.
    const entryIndex = (v?.side ?? -1) < 0 ? 1 : 0;
    stoppers.current.forEach((stop, i) => {
      if (!stop) return;
      const up = i === entryIndex ? v?.entry ?? 1 : 1;
      stop.position.y = p.y - s.height / 2 + up * s.height;
    });
  });
  return (
    <>
      <primitive object={model} dispose={null} />
      <group ref={carriage}>
        {[-1, 1].map((dir, i) => (
          <mesh key={dir} ref={(m) => { stoppers.current[i] = m; }} position={[p.x + dir * gap, p.y + s.height / 2, p.z]}>
            <boxGeometry args={[s.width, s.height, s.depth]} />
            <meshStandardMaterial color="#e0a800" />
          </mesh>
        ))}
      </group>
    </>
  );
}