/**
 * Web Worker: auto-layout search + deterministic headless simulation off the main thread.
 * Protocol (see autoLayoutClient.ts): in { type: "run", constraints, options }; out "progress" | "done" | "error".
 * Cancel by terminating the worker (instant even mid-simulation) or { type: "cancel" } between candidates.
 */
import "@/workers/workerShims";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Group } from "three";
import robotUrl from "@/assets/models/RobotArm.glb?url";
import boxUrl from "@/assets/models/box.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";
import { stripGlbTextures } from "@/domain/layout/stripGlbTextures";
import { simulateTemplate, type SimModels } from "@/domain/layout/simulateLayout";
import { searchLayouts } from "@/domain/layout/searchLayouts";
import type { AutoLayoutRequest, AutoLayoutResponse } from "@/workers/autoLayoutProtocol";

const post = (message: AutoLayoutResponse) => (globalThis as unknown as { postMessage: (m: AutoLayoutResponse) => void }).postMessage(message);
let models: Promise<SimModels> | null = null;
let cancelled = false;

async function loadModel(url: string): Promise<Group> {
  const buffer = stripGlbTextures(await (await fetch(url)).arrayBuffer());
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  return gltf.scene;
}
const loadModels = () => (models ??= Promise.all([robotUrl, boxUrl, palletUrl].map(loadModel)).then(([robot, box, pallet]) => ({ robot, box, pallet })));
/** Yields to the event loop so a "cancel" message can arrive between candidates. */
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function handleRequest(request: AutoLayoutRequest) {
  if (request.type === "cancel") { cancelled = true; return; }
  cancelled = false;
  try {
    const loaded = await loadModels();
    const { seconds, warmup } = request.options;
    const result = await searchLayouts(request.constraints, {
      patterns: request.options.patterns,
      cancelled: () => cancelled,
      onProgress: (progress) => post({ type: "progress", progress: { evaluated: progress.evaluated, total: progress.total, current: progress.current } }),
      evaluate: async (candidate) => { await yieldTask(); return simulateTemplate(candidate.template, loaded, { seconds, warmup }); },
    });
    post({ type: "done", result });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

(globalThis as unknown as { onmessage: (event: MessageEvent<AutoLayoutRequest>) => void }).onmessage = (event) => { void handleRequest(event.data); };
