import { create } from "zustand";
import type { EquipmentPose, EquipmentSettings, SceneEquipment } from "@/types/layout";

export type ModalMode = "move" | "rotate";
/** G axis constraint (world X/Z through the start position); null = free on the ground. */
export type ModalAxis = "x" | "z" | null;
type Session = {
  mode: ModalMode;
  id: string;
  origin: EquipmentPose;
  /** Started by paste/duplicate: cancelling removes the new object again. */
  created: boolean;
};
type Clipboard = { object: SceneEquipment; settings: EquipmentSettings };

/** Blender-style modal G (move) / R (rotate) session and the editor clipboard. */
export const useModalTransformStore = create<{
  session: Session | null;
  axis: ModalAxis;
  setAxis: (axis: ModalAxis) => void;
  clipboard: Clipboard | null;
  begin: (session: Session) => void;
  end: () => void;
  copy: (clipboard: Clipboard) => void;
}>((set) => ({
  session: null,
  axis: null,
  setAxis: (axis) => set({ axis }),
  clipboard: null,
  begin: (session) => set({ session, axis: null }),
  end: () => set({ session: null, axis: null }),
  copy: (clipboard) => set({ clipboard }),
}));
