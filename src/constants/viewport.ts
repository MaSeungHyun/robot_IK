export const RENDER_QUALITY = {
  performance: { maxDpr: 1, multisampling: 0 },
  balanced: { maxDpr: 1.25, multisampling: 2 },
  high: { maxDpr: 1.5, multisampling: 2 },
} as const;

export type RenderQuality = keyof typeof RENDER_QUALITY;

/** Static geometry is batched by world-space sector, allowing each sector to be culled. */
export const INSTANCE_SECTOR_SIZE = 24;
/** After model animation/camera updates, before the composer's render callback at priority 1. */
export const INSTANCE_SYNC_PRIORITY = 0.75;
