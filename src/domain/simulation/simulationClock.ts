import { profileEnd, profileStart } from "@/lib/profiler/frameProfiler";

/**
 * One fixed-timestep clock for the whole factory run: conveyors/boxes, AMRs (FactorySimulator.advance) and every
 * robot controller advance together, in the same order, with the same dt at EVERY playback speed. Robot planning
 * advances a fixed number of steps per sim second (IK_CONFIG.planningStepsPerSecond), so the simulated outcome is
 * independent of playback speed and CPU. Speed only decides how many steps run per rendered frame; when a frame's
 * wall-clock step budget is used up the rest waits (achieved speed drops), it never changes what happens.
 */
export const SIMULATION_CLOCK = {
  /** Fixed step (s of sim time) at every speed. */
  dt: 1 / 60,
  /** Rendered-frame stall clamp (s of real time) before applying playback speed. */
  maxFrameDelta: 0.1,
  /** Wall-clock ms per rendered frame spent stepping (at least one step always runs). */
  frameBudgetMs: 8,
  /** Budget at high playback speeds (>= highSpeed) while the clock is behind its target: stepping may take most
   *  of a 60 Hz frame there, since the user asked for sim throughput over frame rate. */
  highSpeedBudgetMs: 14,
  highSpeed: 10,
  /** Stall clamp at high speeds: long frames there are mostly our own stepping, so less sim time is thrown away. */
  highSpeedMaxFrameDelta: 0.25,
  /** Hard cap of steps per frame. */
  maxSteps: 400,
  /** Backlog kept when the budget runs out (s of sim time); beyond it time is dropped instead of spiralling. */
  maxBacklog: 0.5,
  /** At high speeds the kept backlog also covers this much REAL time (s) times the speed, so a single slow frame
   *  (GC, React commit) is caught up later instead of being dropped (0.5 s of sim time is only 5 ms at 100x). */
  highSpeedBacklogRealSeconds: 0.1,
  /** At high speeds, while behind, the step budget grows to fill a frame of this length (ms) after the measured
   *  non-stepping work of the previous frame (render, React, other useFrame), i.e. ~30 fps floor. A fixed 14 ms
   *  budget left most of each frame to rendering, which capped 100x well below target. */
  highSpeedTargetFrameMs: 33,
  /** Upper bound for that adaptive budget (ms), so the UI never freezes. */
  highSpeedMaxBudgetMs: 28,
} as const;

/** A robot (or any per-step system) advanced by the shared clock. */
export type SimulationParticipant = {
  /** Once per rendered frame before stepping (start/pause). */
  beginFrame(frameKey: number): void;
  /** One fixed simulation step (dt = 0 on frames without a step: paused or below one step of sim time). */
  step(dt: number): void;
  /** Once per rendered frame after stepping (publish readings). */
  endFrame(): void;
};
export type SimulationWorld = { advance(dt: number): void };

/** Startup probe: performance.now() when PLAY was pressed, and ms until the first fixed step ran (dev diagnostics). */
export const simulationStartup = { requestedAt: 0, firstStepMs: -1 };
export function markPlayRequested() { simulationStartup.requestedAt = performance.now(); simulationStartup.firstStepMs = -1; }

export class SimulationClock {
  private readonly participants = new Set<SimulationParticipant>();
  private accumulator = 0;
  private frameKey = 0;
  /** Wall ms spent stepping in the previous frame (adaptive high-speed budget). */
  private lastStepMs = 0;
  /** Diagnostics: smoothed achieved sim-seconds per real second, steps of the last frame, total sim time. */
  readonly stats = { achievedSpeed: 0, steps: 0, dt: SIMULATION_CLOCK.dt, droppedSeconds: 0, simTime: 0 };

  register(participant: SimulationParticipant) {
    this.participants.add(participant);
    return () => { this.participants.delete(participant); };
  }
  reset() {
    this.accumulator = 0;
    this.lastStepMs = 0;
    Object.assign(this.stats, { achievedSpeed: 0, steps: 0, droppedSeconds: 0, simTime: 0 });
  }
  /** One fixed step of the whole simulation (also used directly by headless runs). */
  step(world: SimulationWorld) {
    const dt = SIMULATION_CLOCK.dt;
    const simStart = profileStart();
    world.advance(dt);
    profileEnd("simulation", simStart);
    const robotStart = profileStart();
    for (const participant of this.participants) participant.step(dt);
    profileEnd("robots", robotStart);
    this.stats.simTime += dt;
    if (simulationStartup.firstStepMs < 0 && simulationStartup.requestedAt > 0) simulationStartup.firstStepMs = performance.now() - simulationStartup.requestedAt;
  }
  /**
   * Advance by one rendered frame. `speed` <= 0 (paused/stopped) only runs the per-frame hooks.
   * `budgetMs` limits wall-clock stepping time (Infinity for headless runs).
   */
  frame(realDelta: number, speed: number, world: SimulationWorld, budgetMs?: number) {
    const high = speed >= SIMULATION_CLOCK.highSpeed;
    if (budgetMs === undefined) {
      if (high) {
        // Non-stepping work of the last frame = real frame interval minus our own stepping time.
        const other = Number.isFinite(realDelta) ? Math.max(0, realDelta * 1000 - this.lastStepMs) : 0;
        budgetMs = Math.min(SIMULATION_CLOCK.highSpeedMaxBudgetMs,
          Math.max(SIMULATION_CLOCK.highSpeedBudgetMs, SIMULATION_CLOCK.highSpeedTargetFrameMs - other));
      } else budgetMs = SIMULATION_CLOCK.frameBudgetMs;
    }
    const key = ++this.frameKey, began = performance.now(), dt = SIMULATION_CLOCK.dt;
    for (const participant of this.participants) participant.beginFrame(key);
    let steps = 0, dropped = 0;
    const real = Number.isFinite(realDelta) ? Math.min(Math.max(realDelta, 0), high ? SIMULATION_CLOCK.highSpeedMaxFrameDelta : SIMULATION_CLOCK.maxFrameDelta) : 0;
    if (speed > 0 && Number.isFinite(speed)) {
      this.accumulator += real * speed;
      while (this.accumulator >= dt - 1e-9 && steps < SIMULATION_CLOCK.maxSteps
        && (steps === 0 || performance.now() - began < budgetMs)) {
        this.step(world);
        this.accumulator -= dt;
        steps++;
      }
      const backlog = high ? Math.max(SIMULATION_CLOCK.maxBacklog, speed * SIMULATION_CLOCK.highSpeedBacklogRealSeconds) : SIMULATION_CLOCK.maxBacklog;
      if (this.accumulator > backlog) { dropped = this.accumulator - backlog; this.accumulator = backlog; }
    } else this.accumulator = 0;
    this.lastStepMs = performance.now() - began;
    // Paused frames still let robots apply manual joint edits. Running frames without a step do nothing, so the
    // sequence of controller updates is identical at every playback speed.
    if (steps === 0 && !(speed > 0)) for (const participant of this.participants) participant.step(0);
    for (const participant of this.participants) participant.endFrame();
    const achieved = real > 0 ? steps * dt / real : 0;
    this.stats.achievedSpeed += (achieved - this.stats.achievedSpeed) * 0.1;
    this.stats.steps = steps; this.stats.droppedSeconds = dropped;
  }
}

/** The single clock of the mounted factory run (one run is mounted at a time; reset per world). */
export const simulationClock = new SimulationClock();
