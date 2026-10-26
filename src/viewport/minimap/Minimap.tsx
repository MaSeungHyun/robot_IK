import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
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

/** Per-category minimap colors (flat, no blue) and Korean legend labels, in legend order. */
type Category =
  | "floor"
  | "door"
  | "robot"
  | "conveyor"
  | "pallet"
  | "dock"
  | "scanner"
  | "rack"
  | "amr"
  | "forklift";
const CATEGORY: Record<Category, { label: string; color: string }> = {
  floor: { label: "바닥·룸", color: "rgba(255,255,255,0.18)" },
  door: { label: "문", color: "rgba(255,255,255,0.85)" },
  robot: { label: "로봇", color: "#f59e0b" },
  conveyor: { label: "컨베이어", color: "#a8a29e" },
  pallet: { label: "팔레트 스테이션", color: "#84cc16" },
  dock: { label: "도크", color: "#e879f9" },
  scanner: { label: "스캐너", color: "#fde047" },
  rack: { label: "랙", color: "#f87171" },
  amr: { label: "AMR", color: "#2dd4bf" },
  forklift: { label: "지게차", color: "#fb923c" },
};
const CATEGORY_ORDER = Object.keys(CATEGORY) as Category[];

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
 * and the camera (position + view cone). Redrawn at 10 Hz; expand button shows it fullscreen (scene drops to performance render meanwhile); click recenters the orbit target.
 * +X is right and +Z is down (the default editor view looks toward -Z).
 */
export default function Minimap() {
  const enabled = useViewportSettingsStore((state) => state.minimap);
  const canvas = useRef<HTMLCanvasElement>(null);
  const running = useSimulationStore((state) => state.running);

  const isPlaying = running;
  const fullscreen = useViewportSettingsStore(
    (state) => state.minimapFullscreen,
  );
  const setFullscreen =
    useViewportSettingsStore.getState().setMinimapFullscreen;
  const view = useRef({ scale: 1, ox: 0, oz: 0 });
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 220, height: 124 });
  /** Fullscreen top offset: the app header's bottom edge relative to the viewport (HUD overlays it). */
  const [headerOffset, setHeaderOffset] = useState(0);
  // Categories present (stable string key so the legend only re-renders when the set changes).
  const presentKey = useSceneStore((state) => {
    const kinds = new Set<string>(state.objects.map((o) => o.kind));
    return CATEGORY_ORDER.filter((c) => kinds.has(c)).join(",");
  });
  const [hasForklift, setHasForklift] = useState(false);

  // Match the 3D viewport's aspect (the positioned parent); ResizeObserver also covers window resizes.
  useEffect(() => {
    if (!enabled) return;
    const viewport = box.current?.parentElement;
    if (!viewport) return;
    const update = () => {
      const { width: vw, height: vh } = viewport.getBoundingClientRect();
      if (vw <= 0 || vh <= 0) return;
      if (fullscreen) {
        // Start below the app header (its height varies with wrapping), then fill the rest minus
        // the overlay inset (12 px each side + p-1 + border = 34 px).
        const header = document.querySelector(
          "header[aria-label='애플리케이션 헤더']",
        );
        const top = header
          ? Math.max(
              0,
              Math.round(
                header.getBoundingClientRect().bottom -
                  viewport.getBoundingClientRect().top,
              ),
            )
          : 0;
        setHeaderOffset(top);
        const width = Math.max(1, Math.round(vw - 34)),
          height = Math.max(1, Math.round(vh - top - 34));
        setSize((previous) =>
          previous.width === width && previous.height === height
            ? previous
            : { width, height },
        );
        return;
      }
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
    const header = fullscreen
      ? document.querySelector("header[aria-label='애플리케이션 헤더']")
      : null;
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, [enabled, fullscreen]);

  // Esc closes fullscreen; leaving the component (minimap off/unmount) also restores render settings.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [fullscreen, setFullscreen]);
  useEffect(() => () => setFullscreen(false), [setFullscreen]);

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
      amr: token("--color-brand-primary", CATEGORY.amr.color),
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
      const amrIds = new Set<string>();
      for (const o of objects) if (o.kind === "amr") amrIds.add(o.id);
      for (const o of objects) {
        if (o.kind === "floor") continue;
        if (o.kind === "door") {
          // Door: a gap in the wall line plus a thin marker across it.
          const width = useSceneStore.getState().settings[o.id]?.doorWidth ?? 4;
          rect(
            o.x,
            o.z,
            o.yaw,
            width,
            0.5,
            "rgba(0,0,0,0.55)",
            CATEGORY.door.color,
          );
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
        rect(
          o.x,
          o.z,
          o.yaw,
          w,
          d,
          o.kind in CATEGORY
            ? CATEGORY[o.kind as Category].color
            : colors.equipment,
        );
      }
      // Forklifts: live carriers without an "amr" scene object of their own.
      let forklifts = 0;
      for (const [id, carrier] of minimapLive) {
        if (amrIds.has(id)) continue;
        forklifts++;
        const x = ox + carrier.position.x * scale,
          z = oz + carrier.position.z * scale,
          r = Math.max(2.5, 0.35 * scale);
        context.fillStyle = CATEGORY.forklift.color;
        context.fillRect(x - r, z - r, r * 2, r * 2);
      }
      setHasForklift(forklifts > 0);
      if (minimapCamera.ready) {
        // View cone from the camera's ground position along its horizontal heading.
        const cx = ox + minimapCamera.x * scale,
          cz = oz + minimapCamera.z * scale;
        const heading = Math.atan2(
          Math.cos(minimapCamera.yaw),
          Math.sin(minimapCamera.yaw),
        );
        const length = fullscreen ? 60 : 26,
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
  }, [enabled, size, fullscreen]);

  if (!enabled) return null;
  return (
    // Bottom-left, offset past the editor asset rail (w-12); the perf bar is bottom-centre.
    <div
      ref={box}
      className={cn(
        "absolute z-50 rounded-md border border-white/10 bg-bg-primary/80 p-1 backdrop-blur-sm",
        fullscreen
          ? "inset-3 z-[60]"
          : cn("bottom-3", isPlaying ? "left-3" : "left-14"),
      )}
      style={fullscreen ? { top: headerOffset + 12 } : undefined}
    >
      <button
        type="button"
        aria-label={fullscreen ? "??? ??" : "??? ????"}
        title={fullscreen ? "?? (Esc)" : "????"}
        aria-pressed={fullscreen}
        onClick={() => setFullscreen(!fullscreen)}
        className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-sm border border-white/10 bg-bg-primary/80 text-text-secondary outline-none transition-colors hover:bg-white/10 hover:text-text-primary focus-visible:ring-1 focus-visible:ring-white/40"
      >
        {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
      {fullscreen && (
        <ul
          aria-label="미니맵 범례"
          className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-1 rounded-sm border border-white/10 bg-bg-primary/80 px-2 py-1.5 text-xs text-text-secondary"
        >
          {CATEGORY_ORDER.filter((c) =>
            c === "forklift" ? hasForklift : presentKey.split(",").includes(c),
          ).map((c) => (
            <li key={c} className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0",
                  c === "amr" ? "rounded-full" : "rounded-[2px]",
                )}
                style={{
                  background:
                    c === "amr"
                      ? "var(--color-brand-primary, #2dd4bf)"
                      : CATEGORY[c].color,
                }}
              />
              {CATEGORY[c].label}
            </li>
          ))}
        </ul>
      )}
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
