import { Canvas as R3FCanvas } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Box3, Group, Vector3 } from "three";
import Robot, { type Transfer } from "./Robot";
import { planStack } from "./stacking";
import boxUrl from "@/assets/models/box.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";

const COUNT = 10;
function Demo({
  running,
  onProgress,
}: {
  running: boolean;
  onProgress: (count: number, status: string) => void;
}) {
  const boxAsset = useGLTF(boxUrl);
  const palletAsset = useGLTF(palletUrl);
  const jobs = useRef<Transfer[]>([]);
  const demo = useMemo(() => {
    const root = new Group();
    const palletTemplate = palletAsset.scene.clone(true);
    palletTemplate.scale.setScalar(0.55);
    const palletBounds = new Box3().setFromObject(palletTemplate);
    const palletSize = palletBounds.getSize(new Vector3());
    const palletCenter = palletBounds.getCenter(new Vector3());
    palletTemplate.position.set(
      -palletCenter.x,
      -palletBounds.min.y,
      -palletCenter.z,
    );
    // Keep pickup/drop points within the restricted shoulder/elbow workspace.
    const centers = [new Vector3(2.3, 0, 0), new Vector3(-1.6, 0, 0)];
    centers.forEach((center) => {
      const pallet = new Group();
      pallet.position.copy(center);
      pallet.add(palletTemplate.clone(true));
      root.add(pallet);
    });
    const template = boxAsset.scene.clone(true);
    template.scale.setScalar(0.45);
    const bounds = new Box3().setFromObject(template);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    // Cargo origin is its top center, making attachment and placement exact.
    template.position.set(-center.x, -bounds.max.y, -center.z);
    const plan = planStack(COUNT, palletSize, size);
    const transfers: Transfer[] = [];
    const sourcePositions = plan.slots.map((slot) =>
      slot.position
        .clone()
        .add(centers[0])
        .add(new Vector3(0, palletSize.y + size.y, 0)),
    );
    // Remove the top layer first, then the lower layer. Destination fills
    // from the center outward and finishes each layer before starting another.
    const order = plan.slots
      .map((slot, i) => ({ layer: slot.layer, i }))
      .sort((a, b) => b.layer - a.layer || a.i - b.i);
    order.forEach(({ i }, destinationIndex) => {
      const cargo = new Group();
      // Rotate around the normalized top-center pivot.
      const pivot = new Group();
      pivot.add(template.clone(true));
      pivot.rotation.y = plan.rotated ? Math.PI / 2 : 0;
      cargo.add(pivot);
      cargo.position.copy(sourcePositions[i]);
      root.add(cargo);
      transfers.push({
        box: cargo,
        pickup: sourcePositions[i],
        destination: plan.slots[destinationIndex].position
          .clone()
          .add(centers[1])
          .add(new Vector3(0, palletSize.y + size.y, 0)),
      });
    });
    return { root, transfers };
  }, [boxAsset.scene, palletAsset.scene]);
  useEffect(() => {
    jobs.current = demo.transfers;
    return () => {
      jobs.current = [];
    };
  }, [demo]);
  return (
    <>
      <primitive object={demo.root} />
      <Robot jobs={jobs} running={running} onProgress={onProgress} />
    </>
  );
}

export default function Canvas() {
  const [run, setRun] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({
    count: 0,
    status: "초기 자세 · 시작 대기",
  });
  return (
    <div className="relative w-full h-full">
      <div className="absolute left-5 top-5 z-10 rounded-xl bg-black/70 px-5 py-4">
        <div className="font-semibold">로봇 팔레타이징 데모</div>
        <div className="mt-2 text-sm">
          {progress.status} · {progress.count}/{COUNT}
        </div>
        <div className="mt-1 text-xs text-neutral-300">
          hand1 −90°~90° · hand2 −240°~−50° · hand3 고정
        </div>
        <button
          className="mt-3 rounded bg-blue-600 px-3 py-1 text-sm"
          onClick={() => setRunning((value) => !value)}
        >
          {running ? "일시 정지" : "시작 / 계속"}
        </button>
        <button
          className="mt-3 ml-2 rounded bg-neutral-600 px-3 py-1 text-sm"
          onClick={() => {
            setRunning(false);
            setProgress({ count: 0, status: "초기 자세 · 시작 대기" });
            setRun((value) => value + 1);
          }}
        >
          초기 자세 복원
        </button>
      </div>
      <R3FCanvas
        camera={{ position: [4, 3.5, 5], fov: 45 }}
        gl={{ antialias: true }}
      >
        <ambientLight intensity={2} />
        <directionalLight position={[3, 6, 4]} intensity={2} />
        <gridHelper
          args={[10, 20, "#64748b", "#334155"]}
          position={[0, -0.01, 0]}
        />
        <mesh position={[0, 0.025, 0]}>
          <boxGeometry args={[4.5, 0.05, 0.35]} />
          <meshStandardMaterial color="#475569" />
        </mesh>
        <Suspense fallback={null}>
          <OrbitControls target={[0, 0.8, 0]} enableDamping={false} />
          <Demo
            key={run}
            running={running}
            onProgress={(count, status) => setProgress({ count, status })}
          />
        </Suspense>
      </R3FCanvas>
    </div>
  );
}


