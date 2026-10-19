import type { EquipmentSettings, SceneEquipment } from "@/types/layout";

export function validateScene(
  objects: SceneEquipment[],
  settings: Record<string, EquipmentSettings>,
): string[] {
  const errors: string[] = [];

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
