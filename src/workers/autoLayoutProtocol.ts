import type { LayoutConstraints, LayoutPattern } from "@/domain/layout/autoLayout";
import type { SearchResult } from "@/domain/layout/searchLayouts";

export type AutoLayoutOptions = { seconds: number; warmup: number; top: number; patterns?: LayoutPattern[] };
export type AutoLayoutRequest = { type: "run"; constraints: LayoutConstraints; options: AutoLayoutOptions } | { type: "cancel" };
export type AutoLayoutResponse =
  | { type: "progress"; progress: { evaluated: number; total: number; current: string } }
  | { type: "done"; result: SearchResult }
  | { type: "error"; message: string };
/** UI default: shorter than the CLI (1500/300 s) to keep a run around a minute. */
export const DEFAULT_AUTO_LAYOUT_OPTIONS: AutoLayoutOptions = { seconds: 1080, warmup: 180, top: 5 };
