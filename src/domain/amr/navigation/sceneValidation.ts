import type { EquipmentSettings, SceneEquipment } from "@/types/layout";
import type { SceneLink } from "@/types/links";

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
