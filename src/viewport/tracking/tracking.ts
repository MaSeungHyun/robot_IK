export const TRACKING_VISUALS = {
  color: "#22d3ee",
  groundHeight: 0.018,
  minRadius: 0.2,
  /** Inner ring radius = max(half width, half depth) of the body x this margin. */
  footprintScale: 1.15,
  framePadding: 18,
  /** Robot bracket smoothing rate (1/s, 1 - exp(-rate * dt)). */
  bracketRate: 20,
  boundsInterval: 1 / 30,
  ringSpeed: 0.18,
} as const;

/**
 * Procedural ground ring (unit radius; the ring group is scaled to the footprint radius).
 * Radii are fractions of that radius; speeds are rad/s, sign = direction.
 */
export const TRACKING_RING = {
  glowColor: "#22d3ee",
  fillColor: "#0891b2",
  /** Block color: the --color-brand-primary CSS token (read at mount); this is the fallback. */
  brandToken: "--color-tracking-indicator",
  brandFallback: "#02dfef",
  fillOpacity: 0.14,
  lineOpacity: 0.55,
  arcOpacity: 0.85,
  blockOpacity: 0.6,
  outerArcs: { inner: 1.15, outer: 1.165, speed: 0.1 },
  arcs: { inner: 1.08, outer: 1.1, speed: -0.22 },
  band: { inner: 0.8, outer: 1.0, dividers: 8, line: 0.008 },
  blocks: { inner: 0.83, outer: 0.97, speed: 0.18 },
  innerRing: { inner: 0.7, outer: 0.712, speed: -0.35 },
  layerGap: 0.0001,
  renderOrder: 10,
} as const;
