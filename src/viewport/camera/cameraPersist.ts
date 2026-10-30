/** Last camera view, restored on the next app open. Kept per template scope (same as bookmarks) in localStorage. */
export type SavedView = { position: [number, number, number]; target: [number, number, number] };

const STORAGE_PREFIX = "smart-factory:camera-view:v1:";

const isVec3 = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));

export function loadView(scope: string): SavedView | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_PREFIX + scope) ?? "null") as Partial<SavedView> | null;
    if (!parsed || !isVec3(parsed.position) || !isVec3(parsed.target)) return null;
    // Degenerate (camera on its target) would break OrbitControls.
    const [px, py, pz] = parsed.position, [tx, ty, tz] = parsed.target;
    if (Math.hypot(px - tx, py - ty, pz - tz) < 1e-3) return null;
    return { position: parsed.position, target: parsed.target };
  } catch {
    return null;
  }
}

export function saveView(scope: string, view: SavedView) {
  if (!isVec3(view.position) || !isVec3(view.target)) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(view));
  } catch {
    // Storage full / disabled: the view just is not kept.
  }
}
