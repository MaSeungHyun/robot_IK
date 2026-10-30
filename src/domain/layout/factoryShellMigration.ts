import type { SceneTemplate, TemplateProp } from "@/types/sceneTemplate";

/** factory.glb Rack_m family (same mesh as Rack_m.glb): every copy is drawn, including nodes added to the glb later. */
export const FACTORY_RACK_M_NODES = ["Rack_m", "Rack_m.001", "Rack_m.002", "Rack_m.003", "Prop_Rack_m", "Prop_Rack_m.001", "Prop_Rack_m.002"] as const;

/**
 * factory.glb templates: the glb "Enviroment" node is drawn whole (walls, BG_Floor, metal, ceiling lights), replacing the
 * room kit walls and floor (the floor object stays for navigation walls, doors and floor-click raycasts; see FloorRoom glbShell).
 * Missing Rack_m nodes are added at their authored transforms. Templates without a factory "Enviroment" prop are unchanged.
 */
export function migrateFactoryShell(template: SceneTemplate): SceneTemplate {
  const props = template.props ?? [];
  if (!props.some((p) => p.source === "factory" && p.node === "Enviroment")) return template;
  const next: TemplateProp[] = props.map((p) => (p.source === "factory" && p.node === "Enviroment" && p.excludeMaterials ? { source: p.source, node: p.node, ...(p.position ? { position: p.position } : {}), ...(p.yaw !== undefined ? { yaw: p.yaw } : {}) } : p));
  const listed = new Set(props.filter((p) => p.source === "factory").map((p) => p.node));
  for (const node of FACTORY_RACK_M_NODES) if (!listed.has(node)) next.push({ source: "factory", node });
  const equipment = template.equipment.map((e) => (e.kind === "floor" && e.floor && !e.floor.glbShell ? { ...e, floor: { ...e.floor, glbShell: true } } : e));
  return { ...template, props: next, equipment };
}