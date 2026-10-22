import type { LayoutConstraints } from "@/domain/layout/autoLayout";
import type { SearchResult } from "@/domain/layout/searchLayouts";
import { DEFAULT_AUTO_LAYOUT_OPTIONS, type AutoLayoutOptions, type AutoLayoutRequest, type AutoLayoutResponse } from "@/workers/autoLayoutProtocol";

export type AutoLayoutRun = { promise: Promise<SearchResult>; cancel: () => void };

/** Starts one auto-layout search in a fresh worker; `cancel` terminates it immediately. */
export function runAutoLayout(
  constraints: LayoutConstraints,
  onProgress: (evaluated: number, total: number, current: string) => void,
  options: AutoLayoutOptions = DEFAULT_AUTO_LAYOUT_OPTIONS,
): AutoLayoutRun {
  const worker = new Worker(new URL("./autoLayout.worker.ts", import.meta.url), { type: "module" });
  let settle: { reject: (error: Error) => void } | null = null;
  const promise = new Promise<SearchResult>((resolve, reject) => {
    settle = { reject };
    worker.onmessage = (event: MessageEvent<AutoLayoutResponse>) => {
      const message = event.data;
      if (message.type === "progress") onProgress(message.progress.evaluated, message.progress.total, message.progress.current);
      else if (message.type === "done") { worker.terminate(); resolve(message.result); }
      else { worker.terminate(); reject(new Error(message.message)); }
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || "worker error")); };
  });
  const request: AutoLayoutRequest = { type: "run", constraints, options };
  worker.postMessage(request);
  return {
    promise,
    cancel: () => { worker.terminate(); settle?.reject(new DOMException("cancelled", "AbortError")); },
  };
}
