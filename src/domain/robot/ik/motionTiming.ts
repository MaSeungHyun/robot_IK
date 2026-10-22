/** Zero velocity and acceleration at each end of a segment. */
export function minimumJerk(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return t*t*t*(10+t*(-15+6*t));
}

/**
 * Normalized trapezoidal velocity profile: s(0)=0, s(1)=1, constant acceleration for the first and last
 * `blend` fraction of the time (0 < blend <= 0.5; 0.5 = triangle), constant velocity in between.
 */
export function trapezoid(progress: number, blend: number): number {
  const t = Math.max(0, Math.min(1, progress)), f = Math.min(0.5, Math.max(1e-6, blend)), peak = 1 / (1 - f);
  if (t < f) return peak * t * t / (2 * f);
  if (t > 1 - f) return 1 - peak * (1 - t) * (1 - t) / (2 * f);
  return peak * (t - f / 2);
}

/**
 * Time-optimal synchronized trapezoid for a joint-space move: every joint follows the same normalized
 * `trapezoid(t / duration, blend)` so they start and stop together, and no joint exceeds its speed or
 * acceleration limit. The slowest joint sets the shape; the duration is then stretched until all fit.
 */
export function synchronizedTrapezoid(deltas: ArrayLike<number>, speed: (joint: number) => number, acceleration: (joint: number) => number) {
  let duration = 0, blend = 0.5;
  for (let i = 0; i < deltas.length; i++) {
    const d = Math.abs(deltas[i]), v = speed(i), a = acceleration(i);
    if (d < 1e-9 || !(v > 0) || !(a > 0)) continue;
    const cruise = d >= v * v / a, time = cruise ? d / v + v / a : 2 * Math.sqrt(d / a);
    if (time > duration) { duration = time; blend = cruise ? v / a / time : 0.5; }
  }
  if (duration === 0) return { duration: 0, blend: 0.5 };
  for (let i = 0; i < deltas.length; i++) {
    const d = Math.abs(deltas[i]), v = speed(i), a = acceleration(i);
    if (d < 1e-9 || !(v > 0) || !(a > 0)) continue;
    duration = Math.max(duration, d / ((1 - blend) * v), Math.sqrt(d / (blend * (1 - blend) * a)));
  }
  return { duration, blend };
}
