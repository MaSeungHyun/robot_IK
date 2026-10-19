import type { ThreeEvent } from "@react-three/fiber";
import { useSceneStore } from "@/stores/useSceneStore";

export function inspectEquipment(event: ThreeEvent<MouseEvent>, id: string) {
  if (event.button !== 0 || event.delta > 2 || useSceneStore.getState().editing) return;

  event.stopPropagation();
  useSceneStore.getState().inspect(id);
}
