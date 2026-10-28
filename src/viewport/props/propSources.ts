import factoryGlbUrl from "@/constants/templates/factory.glb?url";
import type { TemplateProp } from "@/types/sceneTemplate";

// rail_in_out.glb (입하/출하 rail) lives only in the optimized set; resolve optionally so models_original builds still work.
const optional = (glob: Record<string, string>) => Object.values(glob)[0];
const railInOutUrl = optional(import.meta.glob<string>("/src/assets/models/rail_in_out.glb", { query: "?url", import: "default", eager: true }));
// AGV.glb: root node "AGV" (pivot = vehicle centre, y 0.208 like factory.glb, scale 1, 1.08 × 1.19 m footprint).
const agvUrl = optional(import.meta.glob<string>("/src/assets/models/AGV.glb", { query: "?url", import: "default", eager: true }));
// Robot pedestals (root "Robot_base" / "robot_arm_place", each with a *_point empty where the robot stands).
const robotBaseUrl = optional(import.meta.glob<string>("/src/assets/models/robot_base.glb", { query: "?url", import: "default", eager: true }));
const robotArmPlaceUrl = optional(import.meta.glob<string>("/src/assets/models/robot_arm_place.glb", { query: "?url", import: "default", eager: true }));

/** Template prop sources (lazy: the 34 MB factory.glb only loads when a template lists props). */
export const PROP_SOURCES: Partial<Record<TemplateProp["source"], string>> = { factory: factoryGlbUrl, railInOut: railInOutUrl, agv: agvUrl, robotBase: robotBaseUrl, robotArmPlace: robotArmPlaceUrl };

/** Props grouped by source url (unavailable sources skipped with a warning). */
export function groupPropsBySource(props: readonly TemplateProp[]): [string, TemplateProp[]][] {
  const map = new Map<string, TemplateProp[]>();
  for (const p of props) { const url = PROP_SOURCES[p.source]; if (url) map.set(url, [...(map.get(url) ?? []), p]); else console.warn(`[GlbProps] source "${p.source}" unavailable; ${p.node} skipped`); }
  return [...map];
}

/** Progressive-load chunk of a prop (see useTemplateLoadStore LOAD_STAGES): 1 structure, 3 equipment, 4 racks, 5 the rest. */
export function propChunk(prop: TemplateProp): number {
  if (prop.source === "robotBase" || prop.source === "robotArmPlace") return 3;
  if (prop.source === "railInOut") return 2;
  if (/^Rack/i.test(prop.node)) return 4;
  if (/^(Enviroment|column|fence|barrier|guardrail|walkway|FloorMarking|wall|floor)/i.test(prop.node)) return 1;
  return 5;
}
