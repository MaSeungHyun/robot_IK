import type { SceneTemplate, TemplateEquipment, TemplateProp } from "@/types/sceneTemplate";

/** factory.glb Rack_m family (same mesh as Rack_m.glb): every copy is drawn, including nodes added to the glb later. */
export const FACTORY_RACK_M_NODES = ["Rack_m", "Rack_m.001", "Rack_m.002", "Rack_m.003", "Prop_Rack_m", "Prop_Rack_m.001", "Prop_Rack_m.002"] as const;

/**
 * factory.glb Rack_m nodes that are real mobile racks (Rack_m.glb equipment, pallet cycle); floor x/z and yaw read from
 * factory.glb (Rack_m relocated). Only Rack_m is enabled; .001-.003 are placed with 작동 활성화 off. Template 06 stores these in its JSON; the migration only fills in 04 / 05. Prop_Rack_m* stay static decoration.
 */
export const FACTORY_MOBILE_RACKS: readonly { node: string; x: number; z: number; yaw: number; enabled?: boolean }[] = [
  // Rack_m moved off the shuttle AMR row (glb -1.59, -2.75) to the open bay west of the fixed racks.
  { node: "Rack_m", x: -17, z: -4, yaw: -Math.PI },
  { node: "Rack_m.001", x: -15.6522, z: -67.6645, yaw: -Math.PI / 2, enabled: false },
  { node: "Rack_m.002", x: -15.6522, z: -64.4135, yaw: -1.754, enabled: false },
  { node: "Rack_m.003", x: -2.2337, z: -57.3127, yaw: -Math.PI, enabled: false },
];
/** Rack_m drop point (south of the fixed racks) and its rack forklift home. */
export const FIXED_RACK_SHIFT_Z = -2;
export const FACTORY_RACK_DROP = { x: -2.2, z: -47, yaw: -Math.PI } as const;
export const FACTORY_RACK_FORKLIFT = { x: 6, z: -50, yaw: 0 } as const;
const MOBILE_RACK_NODES = new Set(FACTORY_MOBILE_RACKS.map((r) => r.node));

/**
 * factory.glb pallet cycle: the glb Rack_m nodes become mobile-rack equipment and the AGV props become AGV equipment
 * (amrRole "agv"), so they are no longer drawn as static props. Appended after the authored equipment (link indices keep).
 * Skipped when the template already has mobile racks or AGVs.
 */
function migrateFactoryCycle(template: SceneTemplate, props: TemplateProp[]): { equipment: TemplateEquipment[]; props: TemplateProp[] } {
  const equipment = [...template.equipment];
  const authored = equipment.some((e) => (e.kind === "rack" && e.settings?.rackType === "mobile") || (e.kind === "amr" && e.settings?.amrRole === "agv"));
  if (authored) return { equipment, props };
  // Fixed racks sit 2 m further back (-z) than the authored 04/05 JSON (06 stores this). Runs once: migrated scenes are authored.
  for (let i = 0; i < equipment.length; i++) {
    const e = equipment[i];
    if (e.kind === "rack" && e.settings?.rackType !== "mobile") equipment[i] = { ...e, z: e.z + FIXED_RACK_SHIFT_Z };
  }
  for (const r of FACTORY_MOBILE_RACKS) equipment.push({ kind: "rack", x: r.x, z: r.z, yaw: r.yaw, settings: { rackType: "mobile", ...(r.enabled === false ? { enabled: false } : {}) } });
  // AGVs bring full racks to a drop point by the fixed racks, where a rack forklift stores the pallets (PalletCycle).
  equipment.push({ kind: "dock", ...FACTORY_RACK_DROP, settings: { dockRole: "rackDrop" } });
  equipment.push({ kind: "amr", ...FACTORY_RACK_FORKLIFT, settings: { amrRole: "forklift", forkliftTask: "rack" } });
  for (const p of props) if (p.source === "agv" && p.position) equipment.push({ kind: "amr", x: p.position[0], z: p.position[2], yaw: p.yaw ?? 0, settings: { amrRole: "agv" } });
  return { equipment, props: props.filter((p) => p.source !== "agv" && !(p.source === "factory" && MOBILE_RACK_NODES.has(p.node))) };
}

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
  // Mobile Rack_m nodes are equipment (06 JSON / migrateFactoryCycle), never re-added as static props.
  for (const node of FACTORY_RACK_M_NODES) if (!listed.has(node) && !MOBILE_RACK_NODES.has(node)) next.push({ source: "factory", node });
  const cycle = migrateFactoryCycle(template, next);
  // Simulator forklifts without a task that collect AMR empty pallets (emptyReturn link targets) are pallet-swap forklifts
  // for those linked AMRs (06 stores this in its JSON).
  const emptyTargets = new Set((template.links ?? []).filter((l) => l.type === "emptyReturn").map((l) => l.to));
  const equipment = cycle.equipment.map((e, i) => {
    if (e.kind === "amr" && e.settings?.amrRole === "forklift" && !e.settings.forkliftTask && emptyTargets.has(i)) return { ...e, settings: { ...e.settings, forkliftTask: "palletSwap" as const } };
    return e.kind === "floor" && e.floor && !e.floor.glbShell ? { ...e, floor: { ...e.floor, glbShell: true } } : e;
  });
  return { ...template, props: cycle.props, equipment };
}