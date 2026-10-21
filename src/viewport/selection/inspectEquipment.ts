import type { ThreeEvent } from "@react-three/fiber";
import { useSceneStore } from "@/stores/useSceneStore";
import { useHudStore } from "@/stores/useHudStore";
import { useCargoStore } from "@/stores/useCargoStore";
import { isSelectionClick } from "@/viewport/selection/isSelectionClick";

/** A press held longer than this is a hold or a slow camera drag, not a click. */
const CLICK_MAX_MS = 400;
let pressedAt = 0;
if (typeof window !== "undefined")
  window.addEventListener("pointerdown", () => { pressedAt = performance.now(); }, { capture: true, passive: true });

/** Same path as the equipment list: inspect the object and switch the HUD to Details. */
export function openEquipmentDetails(id: string) {
  useSceneStore.getState().inspect(id);
  useHudStore.getState().selectInspectorTab("details");
}

export function inspectEquipment(event: ThreeEvent<MouseEvent>, id: string) {
  if (event.button !== 0 || event.delta > 2 || useSceneStore.getState().editing) return;

  event.stopPropagation();
  openEquipmentDetails(id);
}

/**
 * Viewport click on an equipment object. Edit mode keeps plain selection; Play mode opens the
 * object's Details for a short, still left click (orbit drags and long presses are ignored).
 */
export function clickEquipment(event: ThreeEvent<MouseEvent>, id: string) {
  if (!isSelectionClick(event)) return;
  const scene = useSceneStore.getState();
  if (scene.editing) {
    if (scene.pending) return;
    event.stopPropagation();
    scene.select(id);
    return;
  }
  event.stopPropagation();
  if (performance.now() - pressedAt <= CLICK_MAX_MS) openEquipmentDetails(id);
}

const setCursor = (cursor: string) => { document.body.style.cursor = cursor; };
/** Pointer cursor over clickable objects in Play mode. */
export const playHover = {
  onPointerOver: (event: ThreeEvent<PointerEvent>) => {
    if (useSceneStore.getState().editing) return;
    event.stopPropagation();
    setCursor("pointer");
  },
  onPointerOut: () => { if (!useSceneStore.getState().editing) setCursor(""); },
};
export const resetCursor = () => setCursor("");

/** Play-mode click on a cargo box: select it (not the equipment behind) and open its Details. */
export function clickBox(event: ThreeEvent<MouseEvent>, id: string) {
  if (!isSelectionClick(event) || useSceneStore.getState().editing) return;
  event.stopPropagation();
  useCargoStore.getState().selectBox(id);
  useHudStore.getState().selectInspectorTab("details");
}
