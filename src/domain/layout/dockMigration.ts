import type { EquipmentSettings, StopRole } from "@/types/layout";
import type { SceneTemplate, TemplateEquipment } from "@/types/sceneTemplate";

/**
 * Load-time migration of placed docks: only 빈 팔레트 적치장 (palletSource) stays equipment. Every other dock becomes a
 * stop point (same pose/grade) on the nearest equipment that uses it, and 🔗 deliver links to it now point at that owner:
 * 하역 → depalletizing robot, 교체 → service forklift, 출하 대기 → rack forklift, Rack_m 하차 → AGV, 출고 → pallet AMR.
 * Templates without such docks are returned unchanged (same object).
 */
export function migrateTemplateDocks(template: SceneTemplate): SceneTemplate {
  const eq = template.equipment;
  const moved = eq.map((e, i) => (e.kind === "dock" && (e.settings?.dockRole ?? "ship") !== "palletSource" ? i : -1)).filter((i) => i >= 0);
  if (!moved.length) return template;
  const s = (e: TemplateEquipment) => (e.settings ?? {}) as Partial<EquipmentSettings>;
  const forklift = (e: TemplateEquipment) => e.kind === "amr" && (s(e).amrRole === "forklift" || s(e).amrRole === "rack");
  const agv = (e: TemplateEquipment) => e.kind === "amr" && s(e).amrRole === "agv";
  const prefer: Record<StopRole, ((e: TemplateEquipment) => boolean)[]> = {
    unload: [(e) => e.kind === "robot" && s(e).robotRole === "depalletize" && !["normal", "defect"].includes(s(e).pickFilter ?? ""), (e) => e.kind === "robot"],
    service: [(e) => forklift(e) && (s(e).forkliftTask ?? "rack") === "service", forklift],
    stage: [(e) => forklift(e) && (s(e).forkliftTask ?? "rack") === "rack", forklift],
    rackDrop: [agv, (e) => e.kind === "amr"],
    ship: [(e) => e.kind === "amr" && !forklift(e) && !agv(e), (e) => e.kind === "amr"],
  };
  const points = new Map<number, NonNullable<EquipmentSettings["stopPoints"]>>();
  const owner = new Map<number, number>();
  for (const i of moved) {
    const dock = eq[i], role = (s(dock).dockRole ?? "ship") as StopRole;
    const near = (test: (e: TemplateEquipment) => boolean) => {
      let best = -1, d = Infinity;
      eq.forEach((e, j) => { if (e.kind === "dock" || !test(e)) return; const k = Math.hypot(e.x - dock.x, e.z - dock.z); if (k < d) { d = k; best = j; } });
      return best;
    };
    let host = -1;
    for (const test of [...prefer[role], () => true]) if ((host = near(test)) >= 0) break;
    if (host < 0) continue;
    owner.set(i, host);
    const accept = s(dock).acceptGrade;
    points.set(host, [...(points.get(host) ?? []), { role, x: dock.x, z: dock.z, yaw: dock.yaw, ...(accept && accept !== "any" ? { acceptGrade: accept } : {}) }]);
  }
  const gone = new Set(moved);
  const index = new Map<number, number>();
  const equipment: TemplateEquipment[] = [];
  eq.forEach((e, i) => {
    if (gone.has(i)) return;
    index.set(i, equipment.length);
    const extra = points.get(i);
    equipment.push(extra ? { ...e, settings: { ...e.settings, stopPoints: [...(s(e).stopPoints ?? []), ...extra] } } : e);
  });
  // Ids are `${kind}-${index + 1}` (loadTemplate): rewrite id references in settings (e.g. a pallet's mountedOn).
  const reId = (value: unknown): unknown => {
    const m = typeof value === "string" ? /^([a-z]+)-(\d+)$/.exec(value) : null;
    const at = m ? Number(m[2]) - 1 : -1;
    if (!m || eq[at]?.kind !== m[1]) return value;
    const target = gone.has(at) ? owner.get(at) ?? -1 : at, next = index.get(target);
    return next === undefined ? value : `${eq[target].kind}-${next + 1}`;
  };
  for (let k = 0; k < equipment.length; k++) {
    const settings = equipment[k].settings;
    if (!settings) continue;
    const next = Object.fromEntries(Object.entries(settings).map(([key, v]) => [key, reId(v)]));
    if (Object.keys(next).some((key) => next[key] !== (settings as Record<string, unknown>)[key])) equipment[k] = { ...equipment[k], settings: next };
  }
  const links = (template.links ?? []).flatMap((l) => {
    const from = gone.has(l.from) ? owner.get(l.from) : l.from, to = gone.has(l.to) ? owner.get(l.to) : l.to;
    const f = from === undefined ? undefined : index.get(from), t = to === undefined ? undefined : index.get(to);
    return f === undefined || t === undefined ? [] : [{ ...l, from: f, to: t }];
  });
  return { ...template, equipment, links };
}