import type { Group } from "three";

/** Scene id → the editor group that carries the object's transform (for modal G/R). */
export const editableGroups = new Map<string, Group>();
/** Last pointer position over the canvas (client px), so G/R/paste can start under the cursor. */
export const lastPointer = { x: 0, y: 0, inside: false };
