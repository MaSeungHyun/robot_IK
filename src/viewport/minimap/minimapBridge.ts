import type { Object3D } from "three";

/** Live play-mode objects (AMR carriers) by scene id; registered by FactoryRun. */
export const minimapLive = new Map<string, Object3D>();

/** Camera state sampled by MinimapProbe (inside the Canvas) for the DOM minimap. */
export const minimapCamera = { x: 0, z: 0, yaw: 0, targetX: 0, targetZ: 0, ready: false };

/** Set by MinimapProbe: pans the orbit target (and camera with it) to a ground point. */
export const minimapCommands: { lookAt: ((x: number, z: number) => void) | null } = { lookAt: null };
