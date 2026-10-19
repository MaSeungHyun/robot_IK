import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import {
  Box3,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Vector3,
} from "three";
import amrUrl from "@/assets/models/amr.glb?url";
import { AMR_CONFIG } from "@/constants/amr";
import { useInstanceModel } from "@/features/Viewport/instancing/useInstanceModel";

type AMRRoute = { readonly path: readonly Vector3[]; readonly version: number };

function AMRPath({ route }: { route: AMRRoute }) {
  const scene = useThree((state) => state.scene);
  const worldRoot = useMemo(() => new Group(), []);
  useEffect(() => {
    scene.add(worldRoot);
    return () => {
      scene.remove(worldRoot);
    };
  }, [scene, worldRoot]);
  const line = useMemo(() => {
    const line = new Line(
      new BufferGeometry(),
      new LineBasicMaterial({ color: 0x38bdf8 }),
    );
    line.visible = false;
    line.raycast = () => {};
    return line;
  }, []);
  const previous = useRef<{ route: AMRRoute; version: number } | null>(null);
  const lineRef = useRef(line);

  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );

  useFrame(() => {
    if (
      previous.current?.route === route &&
      previous.current.version === route.version
    )
      return;
    previous.current = { route, version: route.version };
    const points = route.path;
    const object = lineRef.current;
    object.geometry.dispose();
    object.geometry = new BufferGeometry().setFromPoints(
      points.map((point) => new Vector3(point.x, 0.025, point.z)),
    );
    object.visible = points.length > 1;
  });
  // Route points are world coordinates, so they must not inherit the moving carrier's transform.
  return createPortal(<primitive object={line} dispose={null} />, worldRoot);
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
  useInstanceModel(model);
  return (
    <>
      <primitive object={model} />
      {route && <AMRPath route={route} />}
    </>
  );
}
