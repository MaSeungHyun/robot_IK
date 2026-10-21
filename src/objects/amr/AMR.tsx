import { Line, useGLTF } from "@react-three/drei";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import type { Line2 } from "three-stdlib";
import amrUrl from "@/assets/models/amr.glb?url";
import { AMR_CONFIG } from "@/constants/amr";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { selectionContext } from "@react-three/postprocessing";

type AMRRoute = { readonly path: readonly Vector3[]; readonly version: number };

const ROUTE_Y = 0.025;
const FLOW_SPEED = 0.9;

function AMRPath({ route }: { route: AMRRoute }) {
  const scene = useThree((state) => state.scene);
  const worldRoot = useMemo(() => new Group(), []);
  useEffect(() => {
    scene.add(worldRoot);
    return () => {
      scene.remove(worldRoot);
    };
  }, [scene, worldRoot]);
  const [points, setPoints] = useState<readonly Vector3[]>([]);
  const previous = useRef<{ route: AMRRoute; version: number } | null>(null);
  const flowLine = useRef<Line2 | null>(null);

  useFrame((state) => {
    if (
      previous.current?.route !== route ||
      previous.current.version !== route.version
    ) {
      previous.current = { route, version: route.version };
      setPoints(
        route.path.map((point) => new Vector3(point.x, ROUTE_Y, point.z)),
      );
    }
    const material = flowLine.current?.material;
    if (material) material.dashOffset = -state.clock.elapsedTime * FLOW_SPEED;
  });
  // Route points are world coordinates, so they must not inherit the moving carrier's transform.
  if (points.length < 2) return null;
  return createPortal(
    <>
      {/* Wide, faint layers fake a glow around the bright core (no bloom pass). */}
      <Line
        points={points}
        color="#0284c7"
        lineWidth={14}
        transparent
        opacity={0.14}
        depthWrite={false}
      />
      <Line
        points={points}
        color="#38bdf8"
        lineWidth={6}
        transparent
        opacity={0.45}
        depthWrite={false}
      />
      <Line
        points={points}
        color="#f0f9ff"
        lineWidth={2.5}
        transparent
        opacity={0.7}
        depthWrite={false}
      />
      {/* Short pulses travelling along the route make the direction of travel readable. */}
      <Line
        ref={flowLine}
        points={points}
        color="#7dd3fc"
        lineWidth={4}
        transparent
        opacity={0.9}
        depthWrite={false}
        dashed
        dashSize={0.22}
        gapSize={0.3}
      />
    </>,
    worldRoot,
  );
}

export default function AMR({ route }: { route?: AMRRoute }) {
  const { scene } = useGLTF(amrUrl);

  const model = useMemo(() => {
    const model = scene.clone(true),
      bounds = new Box3().setFromObject(model),
      size = bounds.getSize(new Vector3());

    model.scale.multiplyScalar(AMR_CONFIG.bodyWidth / Math.max(size.x, size.z));

    bounds.setFromObject(model);

    const center = bounds.getCenter(new Vector3());
    model.position.sub(new Vector3(center.x, bounds.min.y, center.z));

    return model;
  }, [scene]);

  const select = useContext(selectionContext)?.select;

  const emitters = useMemo(() => {
    const meshes = new Set<Mesh>();
    model.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      if (
        materials.some(
          (material) =>
            material instanceof MeshStandardMaterial &&
            material.emissiveIntensity > 0 &&
            material.emissive.getHex() !== 0,
        )
      ) {
        object.userData.excludeFromInstancing = true;
        meshes.add(object);
      }
    });
    return meshes;
  }, [model]);

  useEffect(() => {
    if (!select) return;
    select((previous) => [...previous, ...emitters]);
    return () =>
      select((previous) =>
        previous.filter(
          (object) => !(object instanceof Mesh && emitters.has(object)),
        ),
      );
  }, [emitters, select]);

  useInstanceModel(model);
  return (
    <>
      <primitive object={model} />
      {route && <AMRPath route={route} />}
    </>
  );
}
