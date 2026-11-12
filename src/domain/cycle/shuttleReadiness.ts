import { isServiceTask, normalizeForkliftTask } from "@/constants/forkliftTask";
import type { EquipmentSettings, SceneEquipment } from "@/types/layout";
import type { SceneLink } from "@/types/links";

export type ReadinessCheck = { ok: boolean; required: boolean; label: string; hint: string };

const hasServiceStop = (config?: EquipmentSettings) => (config?.stopPoints ?? []).some((p) => p.role === "service");

/**
 * Edit-time view of the shuttle rules in PalletCycle: a shuttle needs a mounted pallet, and a swap forklift it may use.
 * A forklift with incoming emptyReturn links serves only those AMRs, so an unlinked shuttle is left out of the cycle
 * when every swap forklift is linked to other AMRs (it then idles full with only a log line at run time).
 */
export function shuttleReadiness(
  id: string,
  objects: readonly SceneEquipment[],
  settings: Record<string, EquipmentSettings>,
  links: readonly SceneLink[],
): ReadinessCheck[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  // A forklift that a pallet is 🔗 delivered to gets an auto service stop (withStopPoints).
  const swapForklift = (o: SceneEquipment | undefined) =>
    !!o && o.kind === "amr" && settings[o.id]?.amrRole === "forklift" && isServiceTask(normalizeForkliftTask(settings[o.id]))
    && (hasServiceStop(settings[o.id]) || links.some((l) => l.type === "deliver" && l.to === o.id));
  const exclusive = (forkliftId: string) => links.some((l) => l.type === "emptyReturn" && l.to === forkliftId && byId.get(l.from)?.kind === "amr");

  const mounted = objects.some((o) => o.kind === "pallet" && settings[o.id]?.mountedOn === id);
  const linked = links.filter((l) => l.type === "emptyReturn" && l.from === id).map((l) => byId.get(l.to));
  const linkedSwap = linked.filter(swapForklift);
  const swaps = objects.filter((o) => swapForklift(o));
  const placedServiceDocks = objects.some((o) => o.kind === "dock" && settings[o.id]?.dockRole === "service");
  const openSwap = swaps.some((o) => !exclusive(o.id)) || placedServiceDocks;

  // With no swap stop anywhere the shuttle unloads at a scanner dock instead (still part of the cycle).
  const swapOk = linked.length ? linkedSwap.length > 0 : openSwap || (!swaps.length && !placedServiceDocks);
  const swapHint = linked.length
    ? "연결된 지게차에 교체 위치(정차점)가 없어 셔틀 순환에서 제외됩니다"
    : "교체 지게차가 모두 다른 AMR 전용이라 셔틀 순환에서 제외됩니다 · 🔗 빈 팔레트 반환(AMR → 지게차) 링크를 추가하세요";

  return [
    { ok: mounted, required: true, label: "팔레트 올리기", hint: "없으면 셔틀 순환에서 제외됩니다" },
    { ok: swapOk, required: true, label: "사용할 교체 지게차", hint: swapHint },
    { ok: linked.length > 0, required: false, label: "교체 지게차 연결", hint: "없으면 전용 링크가 없는 지게차만 사용합니다" },
  ];
}
