/** Display-side interpolation helpers for discrete telemetry samples (does not touch simulation data). */

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Shortest-path angle lerp in degrees (wraps through ±180°). */
export function lerpAngleDeg(a: number, b: number, t: number) {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return a + delta * t;
}

/** Frame-rate-independent exponential smoothing factor: 1 - exp(-dt / tau). */
export const smoothingAlpha = (dtMs: number, tauMs: number) => (tauMs <= 0 ? 1 : 1 - Math.exp(-dtMs / tauMs));

type Sample = { t: number; v: number };

/**
 * Buffered interpolation of one scalar: renders `delayMs` behind the newest sample and lerps between
 * the two samples bracketing that render time. Falls back to exponential smoothing toward the latest
 * sample when the buffer cannot bracket the render time (first sample, stalled stream).
 */
export class BufferedScalar {
  private samples: Sample[] = [];
  private current: number | undefined;
  private lastFrame: number | undefined;

  private readonly delayMs: number;
  private readonly tauMs: number;
  private readonly angle: boolean;

  constructor(delayMs: number, tauMs: number, angle = false) {
    this.delayMs = delayMs;
    this.tauMs = tauMs;
    this.angle = angle;
  }

  push(value: number, now: number) {
    const last = this.samples[this.samples.length - 1];
    if (last && last.v === value && now - last.t < this.delayMs) return;
    this.samples.push({ t: now, v: value });
    if (this.samples.length > 8) this.samples.shift();
    this.current ??= value;
  }

  sample(now: number): number | undefined {
    const dt = this.lastFrame === undefined ? 0 : now - this.lastFrame;
    this.lastFrame = now;
    const target = now - this.delayMs;
    const s = this.samples;
    while (s.length > 2 && s[1].t <= target) s.shift();
    const mix = this.angle ? lerpAngleDeg : lerp;

    if (s.length >= 2 && s[0].t <= target && target <= s[1].t) {
      const span = s[1].t - s[0].t;
      this.current = mix(s[0].v, s[1].v, span > 0 ? (target - s[0].t) / span : 1);
    } else if (s.length && this.current !== undefined) {
      this.current = mix(this.current, s[s.length - 1].v, smoothingAlpha(dt, this.tauMs));
    }
    return this.current;
  }
}
