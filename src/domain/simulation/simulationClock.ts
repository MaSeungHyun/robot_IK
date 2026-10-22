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
  frameBudgetMs: 10,
  /** Hard cap of steps per frame. */
  maxSteps: 400,
  /** Backlog kept when the budget runs out (s of sim time); beyond it time is dropped instead of spiralling. */
  maxBacklog: 0.5,
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

export class SimulationClock {
  private readonly participants = new Set<SimulationParticipant>();
  private accumulator = 0;
  private frameKey = 0;
  /** Diagnostics: smoothed achieved sim-seconds per real second, steps of the last frame, total sim time. */
  readonly stats = { achievedSpeed: 0, steps: 0, dt: SIMULATION_CLOCK.dt, droppedSeconds: 0, simTime: 0 };

  register(participant: SimulationParticipant) {
    this.participants.add(participant);
    return () => { this.participants.delete(participant); };
  }
  reset() {
    this.accumulator = 0;
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
  }
  /**
   * Advance by one rendered frame. `speed` <= 0 (paused/stopped) only runs the per-frame hooks.
   * `budgetMs` limits wall-clock stepping time (Infinity for headless runs).
   */
  frame(realDelta: number, speed: number, world: SimulationWorld, budgetMs: number = SIMULATION_CLOCK.frameBudgetMs) {
    const key = ++this.frameKey, began = performance.now(), dt = SIMULATION_CLOCK.dt;
    for (const participant of this.participants) participant.beginFrame(key);
    let steps = 0, dropped = 0;
    const real = Number.isFinite(realDelta) ? Math.min(Math.max(realDelta, 0), SIMULATION_CLOCK.maxFrameDelta) : 0;
    if (speed > 0 && Number.isFinite(speed)) {
      this.accumulator += real * speed;
      while (this.accumulator >= dt - 1e-9 && steps < SIMULATION_CLOCK.maxSteps
        && (steps === 0 || performance.now() - began < budgetMs)) {
        this.step(world);
        this.accumulator -= dt;
        steps++;
      }
      if (this.accumulator > SIMULATION_CLOCK.maxBacklog) { dropped = this.accumulator - SIMULATION_CLOCK.maxBacklog; this.accumulator = SIMULATION_CLOCK.maxBacklog; }
    } else this.accumulator = 0;
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
