import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  MeshBasicMaterial,
  NormalBlending,
  RingGeometry,
} from "three";
import type { Blending, BufferGeometry, Mesh } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TRACKING_RING as R } from "@/viewport/tracking/tracking";

const ROTATION_SPEED_MULTIPLIER = 5;

const noRaycast = () => {};
const TAU = Math.PI * 2;

const arc = (inner: number, outer: number, start: number, length: number) =>
  new RingGeometry(
    inner,
    outer,
    Math.max(4, Math.ceil((96 * length) / TAU)),
    1,
    start,
    length,
  );
const merge = (parts: BufferGeometry[]) => {
  const geometry = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  return geometry;
};
const deg = (value: number) => (value * Math.PI) / 180;
/** Brand color from the theme token (index.css), so the blocks stay in sync with it. */
const brandColor = () =>
  (typeof document !== "undefined" &&
    getComputedStyle(document.documentElement)
      .getPropertyValue(R.brandToken)
      .trim()) ||
  R.brandFallback;

type Layer = {
  geometry: BufferGeometry;
  material: MeshBasicMaterial;
  speed: number;
};

/**
 * Procedural sci-fi tracking ring: broken outer arcs, a segmented translucent band with bright
 * blocks, and a thin inner ring around an empty center. Six flat meshes with shared additive
 * materials (blocks: brand color, normal blending); each layer spins in alternating directions (rotation in useFrame via refs).
 */
export default function TrackingGroundRing() {
  const layers = useMemo<Layer[]>(() => {
    const glow = (
      color: string,
      opacity: number,
      blending: Blending = AdditiveBlending,
    ) =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending,
        depthWrite: false,
        toneMapped: false,
      });
    const arcMaterial = glow(R.glowColor, R.arcOpacity),
      lineMaterial = glow(R.glowColor, R.lineOpacity);
    const { band, blocks, arcs, outerArcs, innerRing } = R;
    const dividers = Array.from({ length: band.dividers }, (_, i) => {
      const at = (i / band.dividers) * TAU + deg(12);
      return arc(band.inner, band.outer, at, band.line / band.outer);
    });
    return [
      // Translucent band fill (normal blending keeps it a clean dark cyan, not grey).
      {
        geometry: arc(band.inner, band.outer, 0, TAU),
        material: glow(R.fillColor, R.fillOpacity, NormalBlending),
        speed: 0,
      },
      {
        geometry: merge([
          arc(band.inner, band.inner + band.line, 0, TAU),
          arc(band.outer - band.line, band.outer, 0, TAU),
          ...dividers,
        ]),
        material: lineMaterial,
        speed: blocks.speed,
      },
      {
        geometry: merge(
          [
            [30, 22],
            [64, 14],
            [196, 26],
            [228, 14],
            [312, 30],
          ].map(([start, length]) =>
            arc(blocks.inner, blocks.outer, deg(start), deg(length)),
          ),
        ),
        // Blocks: exact brand hue; additive blending saturated them to white.
        material: glow(brandColor(), R.blockOpacity, NormalBlending),
        speed: blocks.speed * ROTATION_SPEED_MULTIPLIER,
      },
      {
        geometry: merge(
          [
            [10, 95],
            [130, 70],
            [230, 110],
          ].map(([start, length]) =>
            arc(arcs.inner, arcs.outer, deg(start), deg(length)),
          ),
        ),
        material: arcMaterial,
        speed: arcs.speed,
      },
      {
        geometry: merge(
          [
            [40, 130],
            [200, 120],
          ].map(([start, length]) =>
            arc(outerArcs.inner, outerArcs.outer, deg(start), deg(length)),
          ),
        ),
        material: arcMaterial,
        speed: outerArcs.speed * ROTATION_SPEED_MULTIPLIER,
      },
      {
        geometry: merge([
          arc(innerRing.inner, innerRing.outer, 0, deg(160)),
          arc(innerRing.inner, innerRing.outer, deg(180), deg(165)),
        ]),
        material: lineMaterial,
        speed: innerRing.speed * ROTATION_SPEED_MULTIPLIER,
      },
    ];
  }, []);
  useEffect(
    () => () => {
      for (const layer of layers) layer.geometry.dispose();
      for (const material of new Set(layers.map((layer) => layer.material)))
        material.dispose();
    },
    [layers],
  );

  const meshes = useRef<(Mesh | null)[]>([]);
  useFrame((_state, delta) => {
    for (let i = 0; i < layers.length; i++) {
      const mesh = meshes.current[i];
      if (mesh && layers[i].speed) mesh.rotation.z += delta * layers[i].speed;
    }
  });

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {layers.map((layer, i) => (
        <mesh
          key={i}
          ref={(mesh) => {
            meshes.current[i] = mesh;
          }}
          geometry={layer.geometry}
          material={layer.material}
          position={[0, 0, i * R.layerGap]}
          renderOrder={R.renderOrder + i}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
}
