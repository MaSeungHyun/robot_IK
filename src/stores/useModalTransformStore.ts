import { create } from "zustand";
import type { EquipmentPose, EquipmentSettings, SceneEquipment } from "@/types/layout";

export type ModalMode = "move" | "rotate";
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
  clipboard: Clipboard | null;
  begin: (session: Session) => void;
  end: () => void;
  copy: (clipboard: Clipboard) => void;
}>((set) => ({
  session: null,
  clipboard: null,
  begin: (session) => set({ session }),
  end: () => set({ session: null }),
  copy: (clipboard) => set({ clipboard }),
}));
