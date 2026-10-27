import type { EquipmentSettings, SceneEquipment } from "@/types/layout";
import type { SceneLink } from "@/types/links";
import { beltLength, beltPoint } from "@/domain/conveyor/conveyorLayout";

/** A robot whose reach covers some point of the belt (it can set boxes on it). */
export function robotServesBelt(belt: SceneEquipment, objects: readonly SceneEquipment[], settings: Record<string, EquipmentSettings>) {
  const length = beltLength(belt), points = Array.from({ length: Math.max(2, Math.ceil(length / 0.25) + 1) }, (_, i) => beltPoint(belt, (length * i) / Math.max(1, Math.ceil(length / 0.25))));
  return objects.some((r) => r.kind === "robot" && settings[r.id]?.enabled !== false && points.some((p) => Math.hypot(p.x - r.x, p.z - r.z) <= (settings[r.id]?.reach ?? 2.5)));
}

export function validateScene(
  objects: SceneEquipment[],
  settings: Record<string, EquipmentSettings>,
  links: readonly SceneLink[] = [],
): string[] {
  const errors: string[] = [];

  // AMR type: pallet-inbound conveyors feed only pallet AMRs, box conveyors only box AMRs.
  const byId = new Map(objects.map((o) => [o.id, o]));
  for (const link of links) {
    if (link.type !== "feed") continue;
    const belt = byId.get(link.from), amr = byId.get(link.to);
    if (belt?.kind !== "conveyor" || amr?.kind !== "amr") continue;
    const pallets = settings[belt.id]?.conveyorRole === "inbound" && settings[belt.id]?.inboundUnit === "pallet";
    const boxAmr = settings[amr.id]?.amrCargo === "box";
    if (pallets && boxAmr) errors.push(`${belt.name}: 팔레트 입하 컨베이어는 팔레트 AMR만 연결할 수 있습니다 (${amr.name}은 박스 AMR).`);
    if (!pallets && !boxAmr) errors.push(`${belt.name}: 박스 컨베이어는 박스 AMR만 연결할 수 있습니다 (${amr.name}은 팔레트 AMR).`);
  }

  // Boxes on a pallet need a depalletizing robot: pallet-inbound lines without one cannot unload.
  const depalletizer = objects.some((o) => o.kind === "robot" && settings[o.id]?.enabled !== false && settings[o.id]?.robotRole === "depalletize");
  for (const belt of objects) {
    if (belt.kind !== "conveyor" || settings[belt.id]?.enabled === false) continue;
    if (settings[belt.id]?.conveyorRole === "inbound" && settings[belt.id]?.inboundUnit === "pallet" && !depalletizer)
      errors.push(`${belt.name}: 팔레트 AMR이 실어 온 박스는 로봇이 하역해야 합니다 · 스캐너 라인 시작에 하역(depalletize) 로봇을 배치해 주세요.`);
  }

  // Box outbound ("ship"): a robot must depalletize the boxes onto it, so one has to stand within reach.
  for (const belt of objects) {
    if (belt.kind !== "conveyor" || settings[belt.id]?.enabled === false || settings[belt.id]?.conveyorRole !== "ship") continue;
    if (!robotServesBelt(belt, objects, settings)) errors.push(`${belt.name}: 박스 출하 컨베이어는 로봇이 팔레트에서 박스를 내려 올립니다 · 컨베이어 옆(로봇 도달 거리 안)에 로봇을 배치해 주세요.`);
  }

  for (const object of objects) {
    if (![object.x, object.z, object.yaw].every(Number.isFinite)) {
      errors.push(`${object.name}: 위치와 회전을 확인해 주세요.`);
    }

    const value = settings[object.id];
    if (!value || !Number.isFinite(value.speed) || value.speed <= 0) {
      errors.push(`${object.name}: 작동 속도를 확인해 주세요.`);
    }

    if (
      value?.defectRate !== undefined &&
      (!Number.isFinite(value.defectRate) || value.defectRate < 0 || value.defectRate > 1)
    ) {
      errors.push(`${object.name}: 불량률은 0~100%로 설정해 주세요.`);
    }
  }

  return errors;
}
