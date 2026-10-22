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

/**
 * "high" tier scene bloom: one luminance-threshold pass for everything. Lit white surfaces reach
 * ~1.3-2 in the HDR buffer (ambient 1.5 + sun), so the threshold sits above them; only unlit
 * light sources drawn with toneMapped=false and a colour gain (GLOW_GAIN) cross it, plus the AMR
 * emitters that SelectiveBloom used to handle at the same threshold.
 */
export const SCENE_BLOOM = { threshold: 2.5, smoothing: 0.2, intensity: 0.45, levels: 5, radius: 0.75 } as const;
/** Colour multipliers (linear) for light-source surfaces while scene bloom is on. */
export const GLOW_GAIN = { led: 6, eave: 4.5, window: 3.5 } as const;
