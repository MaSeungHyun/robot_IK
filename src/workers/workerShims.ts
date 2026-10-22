/**
 * Minimal browser globals for store modules evaluated inside the auto-layout Web Worker
 * (same shims as scripts/pick-sim.mjs). Must be the worker's first import.
 */
const scope = globalThis as unknown as Record<string, unknown>;
scope.window ??= globalThis;
scope.document ??= { cookie: "", querySelector: () => null };
scope.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
export {};
