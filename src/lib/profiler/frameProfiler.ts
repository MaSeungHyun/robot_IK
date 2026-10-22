/**
 * DEV-only frame profiler. Hot paths call `profileStart()` / `profileEnd(section, start)`; both are a
 * single boolean check while the perf overlay is off (and always in production builds).
 * PerfCollector turns it on, opens/closes each frame and records spike frames with a breakdown.
 */
export type ProfileSection = "simulation" | "report" | "robots" | "ik" | "instances" | "rebuild" | "outline" | "stats" | "render";
export type FrameSpike = {
  /** performance.now() at the end of the frame. */
  at: number;
  /** Interval since the previous frame (ms): what the user sees as a hitch. */
  interval: number;
  /** JS time inside the frame (useFrame callbacks + render submission). */
  cpu: number;
  /** Section times, largest first. Sections nest (ik ⊂ robots, rebuild ⊂ instances). */
  sections: [ProfileSection, number][];
};

/** A frame slower than this (ms) counts as a spike (≈1.5× a 60 Hz budget). */
export const SPIKE_MS = 25;
const KEEP = 20;

const state = {
  on: false,
  times: new Map<ProfileSection, number>(),
  /** Work between frames (store publishes etc.) is attributed to the next frame. */
  spikes: [] as FrameSpike[],
  count: 0,
  version: 0,
};

export function setProfilerEnabled(on: boolean) {
  state.on = import.meta.env.DEV && on;
  state.times.clear();
  if (!state.on) {
    state.spikes = [];
    state.count = 0;
    state.version++;
  }
}
export const profilerEnabled = () => state.on;

/** Returns a start stamp, or -1 when profiling is off (then profileEnd is a no-op). */
export function profileStart() {
  return state.on ? performance.now() : -1;
}
export function profileEnd(section: ProfileSection, start: number) {
  if (start < 0 || !state.on) return;
  state.times.set(section, (state.times.get(section) ?? 0) + performance.now() - start);
}

/** Closes a frame; returns the recorded spike (or null) and resets the section times. */
export function endFrame(interval: number, cpu: number): FrameSpike | null {
  if (!state.on) return null;
  let spike: FrameSpike | null = null;
  if (interval > SPIKE_MS) {
    spike = { at: performance.now(), interval, cpu, sections: [...state.times].sort((a, b) => b[1] - a[1]) };
    state.spikes = [...state.spikes, spike].slice(-KEEP);
    state.count++;
    state.version++;
  }
  state.times.clear();
  return spike;
}
export const frameSpikes = () => ({ spikes: state.spikes, count: state.count, version: state.version });
export function clearSpikes() {
  state.spikes = [];
  state.count = 0;
  state.version++;
}
