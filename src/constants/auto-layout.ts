/** Auto-layout generation defaults (form inputs): floor width × depth and factory (wall) height, in metres. */
export const AUTO_LAYOUT_DEFAULTS = {
  width: 60,
  depth: 40,
  /** Factory height, tall enough for racks. */
  height: 10,
} as const;

/**
 * Drop-in animation when the auto-layout result is applied (render only), Protoss warp-in look.
 * Each equipment falls `height` m to its spot in `durationMs` (linear), started `staggerMs` after the previous one,
 * drawn with one shared hologram shader (#02dfef, additive, fresnel rim + scanlines). On landing a bright warp band
 * sweeps bottom -> top over the object's height in `revealMs`, ending in a `flashMs` flash, then the original
 * materials are restored. `materialSwap: false` (or nothing swappable) falls back to a plain linear drop of `fallbackDurationMs`.
 */
export const AUTO_LAYOUT_DROP_IN = {
  height: 2.5,
  durationMs: 180,
  staggerMs: 30,
  materialSwap: true,
  fallbackDurationMs: 100,
  revealMs: 340,
  flashMs: 90,
  hologram: {
    color: "#02dfef",
    /** Base body opacity of the hologram. */
    opacity: 0.28,
    rim: 1.1,
    rimPower: 2.2,
    /** Scanlines per world metre and their strength. */
    scanDensity: 14,
    scan: 0.12,
    /** Warp band half-width (fraction of the object height) and brightness. */
    bandWidth: 0.08,
    band: 2.2,
    flash: 1.4,
  },
} as const;
