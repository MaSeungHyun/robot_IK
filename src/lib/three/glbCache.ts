/**
 * One fetch per GLB URL per session (in-flight and finished requests are shared), persisted across reloads in Cache Storage.
 * Production asset URLs are content-hashed, so a cached copy is trusted as is. Dev URLs are not, so a cheap HEAD request
 * compares ETag / Last-Modified / Content-Length with the cached copy and refetches when the file changed.
 */
const CACHE_NAME = "sf-glb-v1";
const buffers = new Map<string, Promise<ArrayBuffer>>();
let fetchCount = 0;

const version = (headers: Headers) => [headers.get("etag"), headers.get("last-modified"), headers.get("content-length")].join("|");

async function download(url: string): Promise<Response> {
  fetchCount++;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GLB ${url}: HTTP ${response.status}`);
  return response;
}

async function load(url: string): Promise<ArrayBuffer> {
  if (typeof caches === "undefined") return (await download(url)).arrayBuffer();
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) {
      if (import.meta.env.PROD) return await hit.arrayBuffer();
      const head = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (head.ok && version(head.headers) === hit.headers.get("x-sf-version")) return await hit.arrayBuffer();
    }
    const response = await download(url);
    const buffer = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set("x-sf-version", version(response.headers));
    cache.put(url, new Response(buffer.slice(0), { headers })).catch(() => {});
    return buffer;
  } catch {
    return (await download(url)).arrayBuffer();
  }
}

export function fetchGlb(url: string): Promise<ArrayBuffer> {
  const key = new URL(url, globalThis.location?.href).href;
  let pending = buffers.get(key);
  if (!pending) {
    pending = load(key);
    buffers.set(key, pending);
    pending.catch(() => buffers.delete(key));
  }
  return pending;
}

/** Network GLB downloads this session (cache hits excluded); for diagnostics. */
export const glbFetchCount = () => fetchCount;