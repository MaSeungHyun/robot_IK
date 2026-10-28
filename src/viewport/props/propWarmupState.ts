import type { Object3D } from "three";

/** Parsed template prop GLB scenes by url, filled by PropWarmup at startup (read by ModelWarmup). */
export const propScenes = new Map<string, Object3D>();
/** Resolves once every template prop GLB (factory.glb, AGV, rail_in_out, pedestals) is downloaded and parsed. */
let resolveWarm: () => void = () => {};
export const propsWarmed = new Promise<void>((resolve) => { resolveWarm = resolve; });
export const markPropsWarmed = () => resolveWarm();