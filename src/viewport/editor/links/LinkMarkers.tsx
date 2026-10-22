import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Line } from "@react-three/drei";
import { CanvasTexture, Mesh, OrthographicCamera, SRGBColorSpace, Vector3, type Group } from "three";
import type { EquipmentKind, SceneEquipment } from "@/types/layout";
import { isSelectionClick } from "@/viewport/selection/isSelectionClick";
import { LINK_COLOR, linkPoint } from "@/viewport/editor/links/linkPoints";
import { pickLinkEnd } from "@/viewport/editor/links/pickLinkEnd";

/** Marker height above the floor per kind (m): just over the equipment's top. */
const MARKER_HEIGHT: Partial<Record<EquipmentKind, number>> = { conveyor: 1.3, robot: 2.2, pallet: 0.9, amr: 1.0, dock: 0.8, rack: 2.6 };
const ABBREV: Partial<Record<EquipmentKind, string>> = { conveyor: "CV", robot: "RB", pallet: "PL", amr: "AMR", dock: "DK", rack: "RK" };
/** World size per metre of camera distance (perspective) → constant on-screen size. */
const SCREEN_SCALE = 0.035;
/** Same on-screen size for the orthographic camera (pixels-ish / zoom). */
const ORTHO_SCALE = 34;
const RENDER_ORDER = 1000;
const NEUTRAL = "#c8d2dc";

/** One white badge texture per kind (ring + abbreviation); the material colour tints it. */
const textures = new Map<string, CanvasTexture>();
function badge(kind: EquipmentKind) {
  const key = ABBREV[kind] ?? "?";
  let texture = textures.get(key);
  if (texture) return texture;
  const size = 128, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.strokeStyle = "#ffffff";
  g.lineWidth = 10;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#ffffff";
  g.font = `600 ${key.length > 2 ? 34 : 44}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(key, size / 2, size / 2 + 2);
  texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  textures.set(key, texture);
  return texture;
}

type MarkerState = { object: SceneEquipment; isSource: boolean; valid: boolean; picking: boolean };

/**
 * Link-mode pick markers: camera-facing badges above each linkable equipment, constant screen
 * size (one useFrame scales all), drawn on top (no depth test) with a stem down to the floor
 * anchor the link paths use. Invalid targets fade and ignore the pointer.
 */
export default function LinkMarkers({ markers }: { markers: MarkerState[] }) {
  const groups = useRef(new Map<string, Group>());
  const world = useMemo(() => new Vector3(), []);
  useFrame(({ camera }) => {
    const ortho = camera instanceof OrthographicCamera;
    for (const group of groups.current.values()) {
      group.getWorldPosition(world);
      const scale = ortho ? ORTHO_SCALE / Math.max(1e-3, camera.zoom) : camera.position.distanceTo(world) * SCREEN_SCALE;
      group.scale.setScalar(scale);
    }
  });
  return (
    <group>
      {markers.map((m) => (
        <Marker key={m.object.id} {...m} register={(group) => {
          if (group) groups.current.set(m.object.id, group);
          else groups.current.delete(m.object.id);
        }} />
      ))}
    </group>
  );
}

function Marker({ object, isSource, valid, picking, register }: MarkerState & { register: (group: Group | null) => void }) {
  const [hover, setHover] = useState(false);
  const p = linkPoint(object), height = MARKER_HEIGHT[object.kind] ?? 1.2;
  const disabled = picking && !valid && !isSource;
  const emphasized = isSource || (picking && valid);
  const color = disabled ? NEUTRAL : emphasized || hover ? LINK_COLOR : NEUTRAL;
  const opacity = disabled ? 0.25 : emphasized || hover ? 1 : 0.75;
  const stem = useMemo(() => [new Vector3(p.x, 0.02, p.z), new Vector3(p.x, height, p.z)], [p.x, p.z, height]);
  useEffect(() => () => { if (hover) document.body.style.cursor = ""; }, [hover]);
  const ignore = () => {};
  // R3F skips props set to `undefined`, so `raycast={undefined}` never restores picking after a
  // marker was disabled (source picked → Esc/clear left the other markers unclickable for good).
  const pick = disabled ? ignore : Mesh.prototype.raycast;
  // A marker disabled under the cursor never gets pointerout: drop the stale hover with it.
  if (disabled && hover) setHover(false);

  return (
    <>
      <Line points={stem} color={color} lineWidth={1} transparent opacity={opacity * 0.6} depthTest={false} renderOrder={RENDER_ORDER - 1} raycast={ignore} />
      <Billboard position={[p.x, height, p.z]} ref={register}>
        {/* Generous invisible hit disc (1.6× the badge). */}
        <mesh
          raycast={pick}
          onClick={(event) => {
            if (!isSelectionClick(event)) return;
            event.stopPropagation();
            pickLinkEnd(object.id);
          }}
          onPointerOver={(event) => { event.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { setHover(false); document.body.style.cursor = ""; }}
        >
          <circleGeometry args={[0.8, 20]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
        </mesh>
        {(isSource || hover) && !disabled && (
          <mesh renderOrder={RENDER_ORDER} raycast={ignore}>
            <circleGeometry args={[0.46, 32]} />
            <meshBasicMaterial color={LINK_COLOR} transparent opacity={isSource ? 0.9 : 0.25} depthWrite={false} depthTest={false} />
          </mesh>
        )}
        <mesh renderOrder={RENDER_ORDER + 1} raycast={ignore} scale={emphasized || hover ? 1.15 : 1}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={badge(object.kind)} color={isSource ? "#0b1014" : color} transparent opacity={opacity} depthWrite={false} depthTest={false} />
        </mesh>
      </Billboard>
    </>
  );
}