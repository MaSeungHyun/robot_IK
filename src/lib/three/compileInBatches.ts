import type { Camera, Material, Object3D, Scene, Texture, WebGLRenderer } from "three";

/** Main-thread budget per frame for warm-up work (ms); the rest of the frame stays free for rendering / input. */
export const WARMUP_BUDGET_MS = 12;

export const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Runs after the next idle period (or the timeout), so startup work does not compete with the first frames. */
export const whenIdle = (timeout = 1500) =>
  new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 200);
  });

/** One gl.compileAsync(scene, camera, target) call, split up by compileInBatches. */
export interface CompileJob {
  scene: Object3D;
  target?: Scene | null;
}

/**
 * Builds the same programs as `gl.compileAsync(job.scene, camera, job.target)` for every job, but one node at a time,
 * yielding a frame whenever the budget is used up. Each per-node compile still gathers lights from the whole job scene
 * and the target (traverseVisible is untouched; only the material traversal is narrowed), so program keys are identical.
 * `enter` / `leave` apply and undo the renderer state the compile needs (render target, shadow type, hidden lights);
 * they run around every slice, so frames rendered in between see the normal state. Resolves once every program is ready.
 */
export async function compileInBatches(gl: WebGLRenderer, camera: Camera, jobs: CompileJob[], enter: () => void = () => {}, leave: () => void = () => {}) {
  const materials = new Set<Material>();
  // Start on a fresh frame: the caller's own setup (cloning, ghost building) already used up the current one.
  await nextFrame();
  let sliceStart = performance.now();
  enter();
  try {
    for (const job of jobs) {
      const nodes: Object3D[] = [];
      job.scene.traverse((node) => { nodes.push(node); });
      for (const node of nodes) {
        const own = Object.getOwnPropertyDescriptor(job.scene, "traverse");
        Object.defineProperty(job.scene, "traverse", { value: (callback: (object: Object3D) => void) => callback(node), configurable: true, writable: true });
        try {
          for (const material of gl.compile(job.scene, camera, job.target ?? null) as Set<Material>) materials.add(material);
        } finally {
          if (own) Object.defineProperty(job.scene, "traverse", own);
          else delete (job.scene as { traverse?: unknown }).traverse;
        }
        if (performance.now() - sliceStart > WARMUP_BUDGET_MS) {
          leave();
          try { await nextFrame(); } finally { enter(); }
          sliceStart = performance.now();
        }
      }
    }
  } finally {
    leave();
  }
  // Same readiness wait as compileAsync (non-blocking with KHR_parallel_shader_compile).
  while (materials.size) {
    for (const material of materials) {
      const program = (gl.properties.get(material) as { currentProgram?: { isReady: () => boolean } }).currentProgram;
      if (program === undefined || program.isReady()) materials.delete(material);
    }
    if (materials.size) await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** gl.initTexture for each texture, a frame budget at a time. */
export async function initTexturesInBatches(gl: WebGLRenderer, textures: Iterable<Texture>) {
  let sliceStart = performance.now();
  for (const texture of textures) {
    gl.initTexture(texture);
    if (performance.now() - sliceStart > WARMUP_BUDGET_MS) {
      await nextFrame();
      sliceStart = performance.now();
    }
  }
}
