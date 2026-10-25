import { useGLTF } from "@react-three/drei";
import { useContext, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Box3,
  Color,
  Group,
  InterleavedBufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { Line2, LineGeometry, LineMaterial } from "three-stdlib";
import { AMR_PATH_LAYERS as LAYERS } from "@/constants/amrPath";
import amrUrl from "@/assets/models/AMR.glb?url";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { selectionContext } from "@react-three/postprocessing";

export type AMRRoute = {
  readonly path: readonly Vector3[];
  readonly version: number;
  /** Next waypoint index; the line is trimmed to start at the carrier. */
  readonly pathCursor: number;
  readonly carrier: { readonly position: Vector3 };
};

const ROUTE_Y = 0.025;
const FLOW_SPEED = 0.9;


/**
 * Shows only the remaining route: from the carrier to the last waypoint.
 * Geometry is rebuilt only when the route or next waypoint changes; each frame
 * just moves the first vertex to the carrier (and its dash distance, so the
 * dash pattern stays fixed in world space instead of sliding).
 */
export function AMRPath({ route }: { route: AMRRoute }) {
  const scene = useThree((state) => state.scene);
  const size = useThree((state) => state.size);
  const { root, geometry, lines, flow } = useMemo(() => {
    const geometry = new LineGeometry(),
      root = new Group();
    root.visible = false;
    const lines = LAYERS.map((layer) => {
      const material = new LineMaterial({
        color: new Color(layer.color).getHex(),
        linewidth: layer.linewidth,
        transparent: true,
        opacity: layer.opacity,
        depthWrite: false,
        dashed: "dashed" in layer,
        dashSize: 0.22,
        gapSize: 0.3,
      });
      const line = new Line2(geometry, material);
      line.frustumCulled = false;
      line.raycast = () => {};
      root.add(line);
      return line;
    });
    return { root, geometry, lines, flow: lines[3].material };
  }, []);
  // Route points are world coordinates, so the lines live at the scene root.
  useEffect(() => {
    scene.add(root);
    return () => {
      scene.remove(root);
      geometry.dispose();
      for (const line of lines) line.material.dispose();
    };
  }, [scene, root, geometry, lines]);
  useEffect(() => {
    for (const line of lines)
      line.material.resolution.set(size.width, size.height);
  }, [lines, size]);

  const built = useRef({
    version: -1,
    cursor: -1,
    path: null as unknown,
    end: 0,
  });
  useFrame((state) => {
    const { path, pathCursor: cursor, carrier, version } = route;
    if (cursor >= path.length) {
      root.visible = false;
      built.current.cursor = -1;
      return;
    }
    const b = built.current,
      at = carrier.position;
    if (b.version !== version || b.cursor !== cursor || b.path !== path) {
      const points = [at.x, ROUTE_Y, at.z];
      for (let i = cursor; i < path.length; i++)
        points.push(path[i].x, ROUTE_Y, path[i].z);
      geometry.setPositions(points);
      lines[3].computeLineDistances();
      // Distances along the whole leg keep dashes anchored in world space as the line shrinks.
      const distances = (
        geometry.attributes.instanceDistanceStart as InterleavedBufferAttribute
      ).data;
      let travelled = 0;
      for (let i = 1; i <= cursor; i++)
        travelled += Math.hypot(
          path[i].x - path[i - 1].x,
          path[i].z - path[i - 1].z,
        );
      let along = travelled;
      for (let i = cursor + 1, k = 1; i < path.length; i++, k++) {
        distances.array[k * 2] = along;
        along += Math.hypot(
          path[i].x - path[i - 1].x,
          path[i].z - path[i - 1].z,
        );
        distances.array[k * 2 + 1] = along;
      }
      distances.array[1] = travelled;
      Object.assign(b, { version, cursor, path, end: travelled });
      root.visible = true;
    }
    // Per frame: only the first vertex follows the carrier.
    const starts = (
        geometry.attributes.instanceStart as InterleavedBufferAttribute
      ).data,
      distances = (
        geometry.attributes.instanceDistanceStart as InterleavedBufferAttribute
      ).data,
      next = path[cursor];
    starts.array[0] = at.x;
    starts.array[2] = at.z;
    distances.array[0] = b.end - Math.hypot(next.x - at.x, next.z - at.z);
    starts.needsUpdate = true;
    distances.needsUpdate = true;
    flow.dashOffset = -state.clock.elapsedTime * FLOW_SPEED;
  });
  return null;
}

export default function AMR({ route }: { route?: AMRRoute }) {
  const { scene } = useGLTF(amrUrl);

  const model = useMemo(() => {
    const model = scene.clone(true),
      bounds = new Box3().setFromObject(model);


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
