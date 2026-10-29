import { useFrame } from "@react-three/fiber";
import type { WebGLRenderer } from "three";
import { useWarmupStore } from "@/stores/useWarmupStore";

/** How often (s) newly compiled shader programs are pinned. */
const PIN_INTERVAL = 1;
type PinnableProgram = { usedTimes: number; name?: string; cacheKey?: string };
const pinned = new WeakSet<object>();
let elapsed = PIN_INTERVAL;

/** Adds one permanent reference to every program not pinned yet (three.js releases a program at 0 uses). */
function pinPrograms(gl: WebGLRenderer) {
  for (const program of (gl.info.programs ?? []) as unknown as PinnableProgram[]) {
    if (pinned.has(program)) continue;
    pinned.add(program);
    program.usedTimes++;
    // Dev diagnostics: programs first compiled after the startup warm-up stall the frame that needs them.
    if (import.meta.env.DEV && useWarmupStore.getState().ready) console.info("[programs] late compile", program.name, program.cacheKey);
  }
}

/**
 * Keeps every compiled shader program alive for the session. Switching edit <-> play remounts all equipment,
 * which disposes the editor's materials; three.js then released their programs and the first play frames had to
 * relink the same shaders synchronously (hundreds of ms of "play" delay). The set of programs is small and bounded
 * (one per material variant), so holding one extra reference each costs little GPU memory. Renders nothing.
 */
export default function ProgramPin() {
  useFrame((state, delta) => {
    elapsed += delta;
    if (elapsed < PIN_INTERVAL) return;
    elapsed = 0;
    pinPrograms(state.gl);
  });
  return null;
}
