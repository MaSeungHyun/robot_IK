import { useEffect, useRef, useState } from "react";
import { footprint } from "@/domain/amr/navigation/layoutNavigation";
import { useSceneStore } from "@/stores/useSceneStore";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";
import type { SceneEquipment } from "@/types/layout";
import {
  minimapCamera,
  minimapCommands,
  minimapLive,
} from "@/viewport/minimap/minimapBridge";
import { cn } from "@/lib/style";
import { useSimulationStore } from "@/stores/useSimulationStore";

/** Width follows the viewport (18 %, clamped); height = width / viewport aspect. */
const WIDTH_RATIO = 0.18,
  MIN_WIDTH = 180,
  MAX_WIDTH = 300,
  PAD = 10,
  MARGIN = 2;

/** Reads a CSS custom property (design tokens) so canvas colors follow the theme. */
const token = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
  fallback;

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
function layoutBounds(objects: SceneEquipment[]): Bounds {
  const b = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  for (const o of objects) {
    const [w, d] =
      o.kind === "floor" && o.floor
        ? [o.floor.width, o.floor.depth]
        : footprint(o.kind);
    const r = Math.hypot(w, d) / 2;
    b.minX = Math.min(b.minX, o.x - r);
    b.maxX = Math.max(b.maxX, o.x + r);
    b.minZ = Math.min(b.minZ, o.z - r);
    b.maxZ = Math.max(b.maxZ, o.z + r);
  }
  if (!Number.isFinite(b.minX))
    return { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  return {
    minX: b.minX - MARGIN,
    maxX: b.maxX + MARGIN,
    minZ: b.minZ - MARGIN,
    maxZ: b.maxZ + MARGIN,
  };
}

/**
 * Top-down 2D minimap (canvas, no second WebGL render): floors, equipment footprints, live AMRs
 * and the camera (position + view cone). Redrawn at 4 Hz; click recenters the orbit target.
 * +X is right and +Z is down (the default editor view looks toward -Z).
 */
export default function Minimap() {
  const enabled = useViewportSettingsStore((state) => state.minimap);
  const canvas = useRef<HTMLCanvasElement>(null);
  const running = useSimulationStore((state) => state.running);

  const isPlaying = running;
  const view = useRef({ scale: 1, ox: 0, oz: 0 });
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 220, height: 124 });

  // Match the 3D viewport's aspect (the positioned parent); ResizeObserver also covers window resizes.
  useEffect(() => {
    if (!enabled) return;
    const viewport = box.current?.parentElement;
    if (!viewport) return;
    const update = () => {
      const { width: vw, height: vh } = viewport.getBoundingClientRect();
      if (vw <= 0 || vh <= 0) return;
      const width = Math.round(
        Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, vw * WIDTH_RATIO)),
      );
      const height = Math.round(width / (vw / vh));
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const element = canvas.current,
      context = element?.getContext("2d");
    if (!element || !context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width: W, height: H } = size;
    element.width = Math.round(W * dpr);
    element.height = Math.round(H * dpr);
    const colors = {
      floor: "rgba(255,255,255,0.05)",
      wall: "rgba(255,255,255,0.18)",
      equipment: "rgba(255,255,255,0.32)",
      amr: token("--color-brand-primary", "#2dd4bf"),
      camera: token("--color-text-primary", "#e5e7eb"),
    };
    const draw = () => {
      const { objects } = useSceneStore.getState();
      const b = layoutBounds(objects);
      // Uniform scale that fits the layout (with its 2 m margin) into the box, centred.
      const scale = Math.min(
        (W - PAD * 2) / (b.maxX - b.minX),
        (H - PAD * 2) / (b.maxZ - b.minZ),
      );
      const ox = (W - (b.maxX - b.minX) * scale) / 2 - b.minX * scale;
      const oz = (H - (b.maxZ - b.minZ) * scale) / 2 - b.minZ * scale;
      view.current = { scale, ox, oz };
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, W, H);
      const rect = (
        x: number,
        z: number,
        yaw: number,
        w: number,
        d: number,
        fill: string,
        stroke?: string,
      ) => {
        context.save();
        context.translate(ox + x * scale, oz + z * scale);
        context.rotate(-yaw);
        context.fillStyle = fill;
        context.fillRect(
          (-w / 2) * scale,
          (-d / 2) * scale,
          w * scale,
          d * scale,
        );
        if (stroke) {
          context.strokeStyle = stroke;
          context.lineWidth = 1;
          context.strokeRect(
            (-w / 2) * scale,
            (-d / 2) * scale,
            w * scale,
            d * scale,
          );
        }
        context.restore();
      };
      for (const o of objects)
        if (o.kind === "floor" && o.floor)
          rect(
            o.x,
            o.z,
            o.yaw,
            o.floor.width,
            o.floor.depth,
            colors.floor,
            o.floor.wallHeight > 0 ? colors.wall : undefined,
          );
      for (const o of objects) {
        if (o.kind === "floor") continue;
        if (o.kind === "door") {
          // Door: a gap in the wall line plus a thin marker across it.
          const width = useSceneStore.getState().settings[o.id]?.doorWidth ?? 4;
          rect(o.x, o.z, o.yaw, width, 0.5, "rgba(0,0,0,0.55)", colors.camera);
          continue;
        }
        const live = minimapLive.get(o.id);
        if (o.kind === "amr") {
          const x = live?.position.x ?? o.x,
            z = live?.position.z ?? o.z;
          context.fillStyle = colors.amr;
          context.beginPath();
          context.arc(
            ox + x * scale,
            oz + z * scale,
            Math.max(2.5, 0.35 * scale),
            0,
            Math.PI * 2,
          );
          context.fill();
          continue;
        }
        const [w, d] = footprint(o.kind);
        rect(o.x, o.z, o.yaw, w, d, colors.equipment);
      }
      if (minimapCamera.ready) {
        // View cone from the camera's ground position along its horizontal heading.
        const cx = ox + minimapCamera.x * scale,
          cz = oz + minimapCamera.z * scale;
        const heading = Math.atan2(
          Math.cos(minimapCamera.yaw),
          Math.sin(minimapCamera.yaw),
        );
        const length = 26,
          spread = 0.45;
        context.fillStyle = "rgba(255,255,255,0.12)";
        context.beginPath();
        context.moveTo(cx, cz);
        context.lineTo(
          cx + Math.cos(heading - spread) * length,
          cz + Math.sin(heading - spread) * length,
        );
        context.lineTo(
          cx + Math.cos(heading + spread) * length,
          cz + Math.sin(heading + spread) * length,
        );
        context.closePath();
        context.fill();
        context.fillStyle = colors.camera;
        context.beginPath();
        context.arc(cx, cz, 3, 0, Math.PI * 2);
        context.fill();
        // Orbit target: small cross.
        const tx = ox + minimapCamera.targetX * scale,
          tz = oz + minimapCamera.targetZ * scale;
        context.strokeStyle = colors.camera;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(tx - 3, tz);
        context.lineTo(tx + 3, tz);
        context.moveTo(tx, tz - 3);
        context.lineTo(tx, tz + 3);
        context.stroke();
      }
    };
    draw();
    const timer = window.setInterval(draw, 100);
    return () => window.clearInterval(timer);
  }, [enabled, size]);

  if (!enabled) return null;
  return (
    // Bottom-left, offset past the editor asset rail (w-12); the perf bar is bottom-centre.
    <div
      ref={box}
      className={cn(
        "absolute bottom-3 left-16 z-50 rounded-md border border-white/10 bg-bg-primary/80 p-1 backdrop-blur-sm",
        isPlaying ? "left-3" : "left-16",
      )}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label="미니맵: 클릭하면 해당 위치로 시점 이동"
        title="미니맵 · 클릭: 시점 이동"
        style={{ width: size.width, height: size.height }}
        className="block cursor-crosshair"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const { scale, ox, oz } = view.current;
          minimapCommands.lookAt?.(
            (event.clientX - bounds.left - ox) / scale,
            (event.clientY - bounds.top - oz) / scale,
          );
        }}
      />
    </div>
  );
}
