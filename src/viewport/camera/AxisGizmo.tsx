import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { CanvasTexture, Vector3 } from "three";

/**
 * GizmoViewport-style axis balls (render inside drei GizmoHelper). drei's own GizmoViewport wires
 * a custom onClick to the heads' pointerout (hover-leave fires it) and tweens the camera on
 * pointerdown, so it is reimplemented here: hover only scales, a real click calls `onSelect`.
 * Every pointer event is stopped so the main scene under the gizmo never sees it, and
 * `onPress` lets the caller suspend the camera controls for the press.
 */
const AXES = [
  { dir: [1, 0, 0], color: "#ff2060", label: "X" },
  { dir: [0, 1, 0], color: "#20df80", label: "Y" },
  { dir: [0, 0, 1], color: "#2080ff", label: "Z" },
  { dir: [-1, 0, 0], color: "#ff2060" },
  { dir: [0, -1, 0], color: "#20df80" },
  { dir: [0, 0, -1], color: "#2080ff" },
] as const;

const stop = (event: ThreeEvent<PointerEvent | MouseEvent>) => event.stopPropagation();

function AxisHead({ dir, color, label, onSelect, onPress }: {
  dir: readonly [number, number, number]; color: string; label?: string;
  onSelect: (direction: Vector3) => void; onPress: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const [hover, setHover] = useState(false);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.beginPath();
    context.arc(32, 32, 16, 0, 2 * Math.PI);
    context.fillStyle = color;
    context.fill();
    if (label) {
      context.font = "18px Inter var, Arial, sans-serif";
      context.textAlign = "center";
      context.fillStyle = "white";
      context.fillText(label, 32, 41);
    }
    return new CanvasTexture(canvas);
  }, [color, label]);
  useEffect(() => () => texture.dispose(), [texture]);
  const disabled = dir[1] < 0;
  const scale = (label ? 1 : 0.75) * (hover && !disabled ? 1.2 : 1);
  return (
    <sprite
      position={dir as unknown as [number, number, number]}
      scale={scale}
      onPointerOver={(event) => { stop(event); setHover(true); }}
      onPointerOut={(event) => { stop(event); setHover(false); }}
      onPointerMove={stop}
      onPointerUp={stop}
      onPointerDown={(event) => { stop(event); if (event.button === 0) onPress(); }}
      onClick={(event) => {
        stop(event);
        if (event.button === 0 && event.delta <= 4 && !disabled) onSelect(new Vector3(...dir));
      }}
      onDoubleClick={stop}
      onContextMenu={stop}
    >
      <spriteMaterial
        map={texture}
        map-anisotropy={gl.capabilities.getMaxAnisotropy() || 1}
        alphaTest={0.3}
        opacity={label ? 1 : 0.75}
        toneMapped={false}
      />
    </sprite>
  );
}

export default function AxisGizmo({ onSelect, onPress }: { onSelect: (direction: Vector3) => void; onPress: () => void }) {
  return (
    <group scale={40}>
      {AXES.slice(0, 3).map(({ dir, color }) => (
        <group key={color} rotation={dir[1] ? [0, 0, Math.PI / 2] : dir[2] ? [0, -Math.PI / 2, 0] : [0, 0, 0]}>
          <mesh position={[0.4, 0, 0]} raycast={() => null}>
            <boxGeometry args={[0.8, 0.05, 0.05]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {AXES.map((axis) => (
        <AxisHead key={axis.dir.join()} dir={axis.dir} color={axis.color} label={"label" in axis ? axis.label : undefined} onSelect={onSelect} onPress={onPress} />
      ))}
    </group>
  );
}