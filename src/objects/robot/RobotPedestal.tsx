import { Suspense, useMemo } from "react";
import { Matrix4, type Object3D } from "three";
import { useGLTF } from "@/lib/three/gltfLoader";
import { ROBOT_PEDESTALS } from "@/constants/robotPedestal";
import { robotPedestalUrls } from "@/constants/modelAssets";

type Kind = keyof typeof ROBOT_PEDESTALS;

/** Pedestal GLB in robot-local space: its *_point empty lands on the robot origin (the arm base). Native scale. */
export default function RobotPedestal({ kind }: { kind: Kind }) {
  const url = robotPedestalUrls[kind];
  // Shared platform (robot_arm_place): drawn once as a template prop, not under every robot.
  if ("shared" in ROBOT_PEDESTALS[kind]) return null;
  if (!url) return null;
  return <Suspense fallback={null}><PedestalModel url={url} kind={kind} /></Suspense>;
}

function PedestalModel({ url, kind }: { url: string; kind: Kind }) {
  const { scene } = useGLTF(url) as unknown as { scene: Object3D };
  const root = useMemo(() => {
    const spec = ROBOT_PEDESTALS[kind];
    const clone = scene.clone(true);
    clone.updateMatrixWorld(true);
    let point = clone.getObjectByName(spec.point);
    if (!point) clone.traverse((o) => { if (!point && /_point$/.test(o.name)) point = o; });
    if (point) {
      if (import.meta.env.DEV && Math.abs(point.matrixWorld.elements[13] - spec.elevation) > 1e-3)
        console.warn(`[RobotPedestal] ${spec.point} height ${point.matrixWorld.elements[13]} != ROBOT_PEDESTALS.${kind}.elevation`);
      clone.applyMatrix4(new Matrix4().copy(point.matrixWorld).invert());
    } else console.warn(`[RobotPedestal] "${spec.point}" not found in ${url}`);
    clone.traverse((o) => { o.castShadow = true; o.receiveShadow = true; o.raycast = () => {}; });
    return clone;
  }, [scene, kind, url]);
  return <primitive object={root} />;
}
