/** Zero velocity and acceleration at each end of a segment. */
export function minimumJerk(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return t*t*t*(10+t*(-15+6*t));
}
