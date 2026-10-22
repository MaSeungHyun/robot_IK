import { useEffect, useMemo } from "react";
import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
} from "three";

/** Half length of each axis line; matches the grid's fade distance so both end together. */
const EXTENT = 500;
/** Just above the grid (at -0.01) to avoid z-fighting, still below the floor plane. */
const Y = -0.005;
/** Same hues as the view gizmo (AxisGizmo). */
const X_COLOR = "#ff2060";
const Z_COLOR = "#2080ff";

function axisLine(color: string, x: number, z: number) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([-x, Y, -z, x, Y, z], 3),
  );
  const line = new LineSegments(
    geometry,
    new LineBasicMaterial({
      color,
      toneMapped: false,
      transparent: true,
      opacity: 0.85,
    }),
  );
  line.raycast = () => {};
  line.castShadow = line.receiveShadow = false;
  line.frustumCulled = false;
  line.renderOrder = 1;
  return line;
}

/** Blender-style world X (red) and Z (blue) axis lines through the origin, drawn with the grid. */
export default function WorldAxes() {
  const lines = useMemo(
    () => [axisLine(X_COLOR, EXTENT, 0), axisLine(Z_COLOR, 0, EXTENT)],
    [],
  );
  useEffect(
    () => () =>
      lines.forEach((line) => {
        line.geometry.dispose();
        (line.material as LineBasicMaterial).dispose();
      }),
    [lines],
  );
  return (
    <>
      {lines.map((line) => (
        <primitive key={line.uuid} object={line} renderOrder={3} />
      ))}
    </>
  );
}
