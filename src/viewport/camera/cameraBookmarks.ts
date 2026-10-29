import type { TemplateProp } from "@/types/sceneTemplate";

/** Camera bookmarks (play mode): Shift+1..0 saves, 1..0 jumps. Slots persist per template in localStorage. */
export type CameraBookmark = { position: [number, number, number]; target: [number, number, number] };

const STORAGE_PREFIX = "smart-factory:camera-bookmarks:";
const DIGITS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"];

/** Slot index 0..9 for Digit1..Digit0 / Numpad1..Numpad0 (event.code, so Shift does not change it), else -1. */
export function bookmarkSlot(code: string) {
  const digit = code.startsWith("Numpad") ? `Digit${code.slice(6)}` : code;
  return DIGITS.indexOf(digit);
}

/** Display number of a slot ("1".."9", "0"). */
export const slotLabel = (slot: number) => String((slot + 1) % 10);

/** Storage scope: the loaded template's props (same template = same slots); no template = "default". */
export function bookmarkScope(props: readonly TemplateProp[]) {
  if (!props.length) return "default";
  const text = JSON.stringify(props);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function loadBookmarks(scope: string): (CameraBookmark | null)[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_PREFIX + scope) ?? "[]") as unknown;
    if (Array.isArray(parsed)) return Array.from({ length: 10 }, (_, i) => (parsed[i] as CameraBookmark | null) ?? null);
  } catch {
    // Corrupt entry: start empty.
  }
  return Array.from({ length: 10 }, () => null);
}

export function saveBookmark(scope: string, slot: number, bookmark: CameraBookmark) {
  const slots = loadBookmarks(scope);
  slots[slot] = bookmark;
  try {
    localStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(slots));
  } catch {
    // Storage full / disabled: the bookmark just is not kept.
  }
}

let toastTimer = 0;
/** Small transient notice (no app toast system exists). */
export function showBookmarkToast(text: string) {
  let el = document.getElementById("camera-bookmark-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "camera-bookmark-toast";
    Object.assign(el.style, {
      position: "fixed", left: "50%", bottom: "32px", transform: "translateX(-50%)", zIndex: "1000",
      padding: "6px 14px", borderRadius: "6px", background: "rgba(20, 24, 32, 0.85)", color: "#fff",
      font: "13px system-ui, sans-serif", pointerEvents: "none", transition: "opacity 0.2s",
    });
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.opacity = "1";
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.style.opacity = "0"; }, 1200);
}