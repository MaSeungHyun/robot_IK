import { useLayoutEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Object3D, Vector3, type DirectionalLight } from "three";
import { useSceneStore } from "@/stores/useSceneStore";
import {
  selectShadowQuality,
  useViewportSettingsStore,
  type ShadowQuality,
} from "@/stores/useViewportSettingsStore";
import type { SceneEquipment } from "@/types/layout";

/** Same direction and intensity as the previous unshadowed key light. */
const DIRECTION = new Vector3(3, 8, 4).normalize();
/** Robot reach and AMR routes extend past the equipment origins. */
const PADDING = 2.5;
const SHADOW = {
  low: { mapSize: 1024, radius: 2 },
  high: { mapSize: 2048, radius: 3 },
} satisfies Record<
  Exclude<ShadowQuality, "off">,
  { mapSize: number; radius: number }
>;
const noRaycast = () => {};

/** Layout footprint as [centerX, centerZ, radius], rounded so small edits don't refit. */
function layoutBounds(objects: SceneEquipment[]): [number, number, number] {
  if (!objects.length) return [0, 0, 6];
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const object of objects) {
    const half = object.floor
      ? Math.max(object.floor.width, object.floor.depth) / 2
      : 0;
    minX = Math.min(minX, object.x - half);
    maxX = Math.max(maxX, object.x + half);
    minZ = Math.min(minZ, object.z - half);
    maxZ = Math.max(maxZ, object.z + half);
  }
  const round = (value: number) => Math.round(value * 2) / 2;
  return [
    round((minX + maxX) / 2),
    round((minZ + maxZ) / 2),
    Math.ceil(Math.hypot(maxX - minX, maxZ - minZ) / 2 + PADDING),
  ];
}

/**
 * Key light with one shadow map whose orthographic camera is fitted to the layout bounds. It is
 * refitted only when the layout or quality changes; the map itself renders every frame because
 * robots and AMRs move. A ShadowMaterial plane catches shadows on the open grid.
 */
export default function ShadowLight() {
  const quality = useViewportSettingsStore(selectShadowQuality);
  const [cx, cz, radius] = useSceneStore(
    useShallow((state) => layoutBounds(state.objects)),
  );
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);

  useLayoutEffect(() => {
    const key = light.current;
    if (!key) return;
    const distance = radius + 10;
    target.position.set(cx, 0, cz);
    target.updateMatrixWorld();
    key.position.copy(DIRECTION).multiplyScalar(distance).add(target.position);
    key.castShadow = quality !== "off";
    if (quality === "off") return;
    const { mapSize, radius: blur } = SHADOW[quality];
    const shadow = key.shadow,
      camera = shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = 1;
    camera.far = distance * 2;
    camera.updateProjectionMatrix();
    if (shadow.mapSize.x !== mapSize) {
      shadow.mapSize.set(mapSize, mapSize);
      shadow.map?.dispose();
      shadow.map = null;
    }
    shadow.radius = blur;
    shadow.bias = -0.0004;
    shadow.normalBias = 0.02;
    shadow.needsUpdate = true;
  }, [cx, cz, radius, quality, target]);

  return (
    <>
      <primitive object={target} />
      <directionalLight ref={light} target={target} intensity={2} />
      <mesh
        visible={quality !== "off"}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[cx, -0.004, cz]}
        receiveShadow
        raycast={noRaycast}
      >
        <planeGeometry args={[radius * 2, radius * 2]} />
        <shadowMaterial transparent opacity={0.6} depthWrite={false} />
      </mesh>
    </>
  );
}
