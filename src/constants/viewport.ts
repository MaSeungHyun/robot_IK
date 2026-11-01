export const RENDER_QUALITY = {
  performance: { maxDpr: 1 },
  balanced: { maxDpr: 1.25 },
  high: { maxDpr: 1.5 },
} as const;

/** EffectComposer MSAA samples when antialiasing is on. WebGL canvas MSAA stays off. */
export const ANTIALIAS_SAMPLES = 2;

export type RenderQuality = keyof typeof RENDER_QUALITY;

/** Static geometry is batched by world-space sector, allowing each sector to be culled. */
export const INSTANCE_SECTOR_SIZE = 24;
/** After model animation/camera updates, before the composer's render callback at priority 1. */
export const INSTANCE_SYNC_PRIORITY = 0.75;

