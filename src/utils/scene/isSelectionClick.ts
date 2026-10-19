import type { ThreeEvent } from "@react-three/fiber";

export function isSelectionClick(event: ThreeEvent<MouseEvent>) {
  return event.button === 0 && event.delta <= 2 && event.detail <= 1;
}
