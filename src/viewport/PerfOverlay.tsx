import { useEffect, useState } from "react";
import { addAfterEffect, addEffect, useThree } from "@react-three/fiber";
import { useThumbnailStore } from "@/stores/useThumbnailStore";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";

const isTyping = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    'input,textarea,select,[contenteditable="true"],[role="textbox"]',
  );

type Reading = {
  fps: number;
  cpu: number;
  calls: number;
  triangles: number;
  lines: number;
  points: number;
  geometries: number;
  textures: number;
};

/** Latest smoothed values, written by PerfCollector and polled by PerfReadout (no React per frame). */
const latest: { reading: Reading | null } = { reading: null };

/**
 * In-Canvas collector. Uses only R3F's global before/after-frame callbacks (addEffect /
 * addAfterEffect): no prototype patching (r3f-perf's Scene.prototype getters recursed with a
 * browser devtools extension that also hooks onBeforeRender). gl.info.autoReset is turned off
 * and reset at frame start so the counters cover the whole frame, including every
 * EffectComposer pass. Mounted only after thumbnails are baked, as before.
 */
export function PerfCollector() {
  const enabled = useViewportSettingsStore((state) => state.perfOverlay);
  const baked = useThumbnailStore((state) => state.baked);
  // Read gl inside the effect (via get) rather than mutating a hook-returned value.
  const get = useThree((state) => state.get);

  useEffect(() => {
    if (!enabled || !baked) return;
    const info = get().gl.info,
      autoReset = info.autoReset;
    info.autoReset = false;
    let frameStart = 0,
      lastFrame = 0,
      fps = 0,
      cpu = 0;
    const smooth = (previous: number, next: number) =>
      previous ? previous + (next - previous) * 0.1 : next;
    const before = addEffect((timestamp) => {
      frameStart = performance.now();
      if (lastFrame)
        fps = smooth(fps, 1000 / Math.max(timestamp - lastFrame, 0.001));
      lastFrame = timestamp;
      info.reset();
    });
    const after = addAfterEffect(() => {
      // JS time for the frame: useFrame callbacks + render submission (not GPU execution).
      cpu = smooth(cpu, performance.now() - frameStart);
      latest.reading = {
        fps,
        cpu,
        calls: info.render.calls,
        triangles: info.render.triangles,
        lines: info.render.lines,
        points: info.render.points,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      };
    });
    return () => {
      before();
      after();
      info.autoReset = autoReset;
      latest.reading = null;
    };
  }, [enabled, baked, get]);

  return null;
}
const COLORS = {
  fps: "#00ff00",
  cpu: "#00acff",
  gpu: "#ff0000",
  calls: "#00ffff",
  triangles: "#ffff00",
  geometries: "#ff00ff",
  textures: "#000000",
}; /** 120 s of history at 4 Hz, kept outside React (fixed-size ring buffers). */
const HISTORY = 480;
const TRENDS = [
  { key: "fps", label: "FPS", format: (v: number) => v.toFixed(0) },
  { key: "cpu", label: "CPU ms", format: (v: number) => v.toFixed(2) },
  {
    key: "calls",
    label: "Calls",
    format: (v: number) => Math.round(v).toLocaleString(),
  },
  {
    key: "triangles",
    label: "Tris",
    format: (v: number) => Math.round(v).toLocaleString(),
  },
  {
    key: "geometries",
    label: "Geo",
    format: (v: number) => String(Math.round(v)),
  },
  {
    key: "textures",
    label: "Tex",
    format: (v: number) => String(Math.round(v)),
  },
] as const;
type TrendKey = (typeof TRENDS)[number]["key"];
const history = {
  size: 0,
  head: 0,
  series: Object.fromEntries(
    TRENDS.map(({ key }) => [key, new Float32Array(HISTORY)]),
  ) as Record<TrendKey, Float32Array>,
};
function pushHistory(reading: Reading) {
  for (const { key } of TRENDS)
    history.series[key][history.head] = reading[key];
  history.head = (history.head + 1) % HISTORY;
  history.size = Math.min(history.size + 1, HISTORY);
}

const CHART_W = 220,
  CHART_H = 40;

/** One metric: sparkline (oldest → newest, left → right) with current/min/max/avg. */
function Trend({
  label,
  values,
  format,
}: {
  label: string;
  values: number[];
  format: (v: number) => string;
}) {
  let min = Infinity,
    max = -Infinity,
    sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const n = values.length,
    span = max - min || 1;
  let points = "";
  for (let i = 0; i < n; i++) {
    const x =
      n > 1
        ? (i / (HISTORY - 1)) * CHART_W + (1 - n / HISTORY) * CHART_W
        : CHART_W;
    const y = CHART_H - 2 - ((values[i] - min) / span) * (CHART_H - 4);
    points += `${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-text-secondary">{label}</span>
        <span className="text-sm text-text-primary tabular-nums">
          {n ? format(values[n - 1]) : "—"}
        </span>
      </div>
      <svg
        width={CHART_W}
        height={CHART_H}
        className="rounded-sm bg-white/[.04]"
        aria-hidden
      >
        <polyline
          points={points}
          fill="none"
          strokeWidth={1.25}
          className="stroke-brand-primary"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-text-secondary tabular-nums">
        <span>최소 {n ? format(min) : "—"}</span>
        <span>평균 {n ? format(sum / n) : "—"}</span>
        <span>최대 {n ? format(max) : "—"}</span>
      </div>
    </div>
  );
}

/** DOM half (outside the Canvas): Shift+P toggle and a token-styled readout polled at 4 Hz. */
export default function PerfReadout() {
  const enabled = useViewportSettingsStore((state) => state.perfOverlay);
  const expanded = useViewportSettingsStore((state) => state.perfExpanded);
  const [reading, setReading] = useState<Reading | null>(null);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat
      )
        return;
      if (event.code !== "KeyP" || isTyping(event.target)) return;
      event.preventDefault();
      useViewportSettingsStore.getState().togglePerfOverlay();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (latest.reading) pushHistory(latest.reading);
      setReading(latest.reading);
    }, 250);
    return () => window.clearInterval(timer);
  }, [enabled]);

  if (!enabled) return null;
  const items: [string, string][] = reading
    ? [
        ["FPS", reading.fps.toFixed(0)],
        ["CPU", `${reading.cpu.toFixed(2)}ms`],
        ["Calls", reading.calls.toLocaleString()],
        ["Tris", reading.triangles.toLocaleString()],
        ["Lines", reading.lines.toLocaleString()],
        ["Geo", String(reading.geometries)],
        ["Tex", String(reading.textures)],
      ]
    : [["Perf", "대기 중…"]];
  // Ordered oldest → newest; copied only when the panel is open (4 Hz, ≤ 6 × 480 floats).
  const trends = expanded
    ? TRENDS.map(({ key, label, format }) => {
        const series = history.series[key],
          values: number[] = [];
        const start = (history.head - history.size + HISTORY) % HISTORY;
        for (let i = 0; i < history.size; i++)
          values.push(series[(start + i) % HISTORY]);
        return { key, label, format, values };
      })
    : [];
  // The bar sits at the bottom, so the panel opens upward from it (column-reverse keeps the bar fixed).
  return (
    <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 flex-col-reverse items-center gap-1.5 font-mono text-[11px]">
      <button
        type="button"
        aria-label="성능"
        aria-expanded={expanded}
        title={`성능 오버레이 (Shift+P) · 클릭: 추이 ${expanded ? "접기" : "펼치기"}`}
        onClick={() => useViewportSettingsStore.getState().togglePerfExpanded()}
        className="flex gap-3 rounded-md border border-white/10 bg-bg-primary/90 px-3 py-1.5 text-text-secondary outline-none backdrop-blur-sm transition-colors hover:bg-bg-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
      >
        {items.map(([label, value]) => (
          <span
            key={label}
            style={{
              color: COLORS[label.toLowerCase() as keyof typeof COLORS],
            }}
          >
            {label}{" "}
            <span className="text-text-primary tabular-nums">{value}</span>
          </span>
        ))}
      </button>
      {expanded && (
        <div
          role="region"
          aria-label="성능 추이 (최근 2분)"
          className="grid grid-cols-3 gap-x-4 gap-y-3 rounded-md border border-white/10 bg-bg-primary/95 p-3 backdrop-blur-sm"
        >
          {trends.map(({ key, label, format, values }) => (
            <Trend key={key} label={label} values={values} format={format} />
          ))}
        </div>
      )}
    </div>
  );
}
