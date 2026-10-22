import type { StateStorage } from "zustand/middleware";

const MAX_AGE_S = 60 * 60 * 24 * 365;
/** Browsers drop cookies above ~4KB (name + value). */
const MAX_COOKIE_BYTES = 4000;

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split("; ")) {
    if (!part.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(part.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return null;
}

export function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  const entry = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  if (entry.length > MAX_COOKIE_BYTES) {
    console.warn(`[cookie] ${name} exceeds ${MAX_COOKIE_BYTES} bytes; not saved`);
    return;
  }
  document.cookie = `${entry}; path=/; max-age=${MAX_AGE_S}; SameSite=Lax`;
}

export function removeCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Synchronous cookie storage for zustand `persist`: reads happen during store creation,
 * so persisted values are applied before the first render (no flicker). Writes are debounced.
 */
export function createCookieStorage(delayMs = 300): StateStorage {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    getItem: (name) => readCookie(name),
    setItem: (name, value) => {
      clearTimeout(timers.get(name));
      timers.set(
        name,
        setTimeout(() => {
          timers.delete(name);
          writeCookie(name, value);
        }, delayMs),
      );
    },
    removeItem: (name) => {
      clearTimeout(timers.get(name));
      timers.delete(name);
      removeCookie(name);
    },
  };
}
