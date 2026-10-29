import { useEffect, useState } from "react";
import { useProgress } from "@react-three/drei";
import { useModelsSettled } from "@/stores/useModelStore";
import { useThumbnailStore } from "@/stores/useThumbnailStore";
import { useWarmupStore } from "@/stores/useWarmupStore";

/** Loading stages in order: [from %, to %] of the single bar, label and the task line under it. */
const STAGES = {
  download: {
    range: [0, 55],
    label: "LOADING ASSETS",
    task: "DOWNLOADING MODELS / TEXTURES",
  },
  parse: {
    range: [55, 62],
    label: "LOADING SCENE",
    task: "GEOMETRY / MATERIALS",
  },
  shaders: {
    range: [62, 78],
    label: "LOADING SCENE",
    task: "SHADER WARMUP / EQUIPMENT",
  },
  lighting: {
    range: [78, 90],
    label: "LOADING SCENE",
    task: "SHADER WARMUP / FACTORY LIGHTING / PROPS",
  },
  post: { range: [90, 95], label: "LOADING SCENE", task: "POST-PROCESSING" },
  thumbnails: {
    range: [95, 100],
    label: "FINALIZING",
    task: "BAKING THUMBNAILS",
  },
} as const;
type Stage = keyof typeof STAGES;

/**
 * Full-screen startup screen: blocks the app until models are loaded, shaders are compiled and thumbnails are baked.
 * One monotonic bar weighted across the stages; phases without a measurable % creep toward their end.
 */
export default function StartupOverlay() {
  const progress = useProgress((state) => state.progress);
  const downloading = useProgress((state) => state.active);
  const settled = useModelsSettled();
  const phase = useWarmupStore((state) => state.phase);
  const warmed = useWarmupStore((state) => state.ready);
  const baked = useThumbnailStore((state) => state.baked);
  const done = warmed && baked;
  const stage: Stage = warmed
    ? "thumbnails"
    : phase !== "idle"
      ? phase
      : downloading || progress < 100 || !settled
        ? downloading || progress < 100
          ? "download"
          : "parse"
        : "parse";

  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (done) return;
    const enteredAt = performance.now();
    const id = setInterval(() => {
      const [from, to] = STAGES[stage].range;
      // Download has a real %, the others ease toward 90% of their span (time constant 3 s) until the next stage.
      const part =
        stage === "download"
          ? useProgress.getState().progress / 100
          : 0.9 * (1 - Math.exp(-(performance.now() - enteredAt) / 3000));
      const target = from + (to - from) * Math.min(1, Math.max(0, part));
      setShown((value) => Math.max(value, target));
    }, 100);
    return () => clearInterval(id);
  }, [done, stage]);

  if (done) return null;

  const { label, task } = STAGES[stage];

  const percent = Math.min(99, Math.floor(shown));

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto absolute inset-0 z-500 overflow-hidden bg-black text-text-primary select-none"
    >
      <img
        src="/splash.png"
        alt=""
        aria-hidden
        className="absolute inset-y-0 right-0 h-full w-4/5 object-cover object-center"
      />
      {/* <div className="absolute inset-0 bg-linear-to-r from-black from-20% via-black/80 via-35% to-transparent to-80%" />
      <div className="absolute inset-0 bg-linear-to-t from-black from-10% via-black/75 via-25% to-transparent to-55%" /> */}
      <div className="absolute inset-0 bg-linear-to-r from-black from-20% via-black/80 via-25% to-transparent to-60%" />
      <div className="absolute inset-0 bg-linear-to-t from-black from-10% via-black/75 via-25% to-transparent to-55%" />
      <div className="absolute top-12 left-12 flex items-center gap-4 text-base tracking-widest text-text-primary/80">
        <svg
          viewBox="0 0 32 32"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          aria-hidden
          className="size-8"
        >
          <path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" />
          <path d="M16 2v28M3 9.5l26 13M29 9.5 3 22.5" opacity="0.5" />
        </svg>
        <span className="h-6 w-px bg-text-primary/30" />
        <span>GRAPICAR TWIN STUDIO</span>
      </div>
      <div className="absolute bottom-1/5 left-12 max-w-4xl">
        <h1 className="text-5xl leading-none font-semibold tracking-tight md:text-7xl xl:text-8xl">
          Build your factory.
          <br />
          <span className="bg-linear-to-b from-text-primary via-40% via-text-primary to-text-primary/60 bg-clip-text font-semibold text-transparent">
            Simulate it.
          </span>
        </h1>
        <p className="mt-3 text-base text-text-primary/60 md:text-lg xl:text-xl">
          Prepare your factory operations with Grapicar.
        </p>
      </div>
      <div className="absolute inset-x-12 bottom-16">
        <div className="mb-2 flex items-end justify-between text-base tracking-widest">
          <span className="text-text-primary/90">{label}</span>
          <span className="tabular-nums tracking-wider text-text-primary/80">
            {percent}%
          </span>
        </div>
        <div className="h-1 w-full bg-text-primary/15">
          <div
            className="h-full bg-brand-primary shadow-lg shadow-brand-primary/80 transition-all duration-150 ease-out"
            style={{ width: `${shown}%` }}
          />
        </div>
        <div className="mt-3 flex justify-between text-base tracking-widest text-text-primary/45">
          <span>{task}</span>
          <span>PLEASE WAIT</span>
        </div>
      </div>
    </div>
  );
}
