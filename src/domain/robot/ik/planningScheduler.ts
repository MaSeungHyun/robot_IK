import { IK_CONFIG } from "@/constants/simulation";

/** Per-frame planning allowance handed to one robot controller. */
export type PlanningBudget = {
  /** `priority` (moving-box tracking) may use whatever is left of the frame total, ignoring share and turn. */
  take(wanted: number, priority?: boolean): number;
  /** Report time actually used beyond what `take` granted, so later planners this frame get less. */
  charge?(ms: number): void;
};
/** Grants smaller than this (ms) are refused: one generator step would overrun them anyway. */
const MIN_SLICE_MS = 0.25;

/**
 * Shares one IK planning budget per rendered frame between the robots that plan.
 * Each robot may use at most `total / n` ms per frame, where n is the number of robots that
 * asked for planning time in the previous frame, so simultaneous plans are spread over frames
 * instead of stacking. When the per-robot share would drop below `minShareMs`, robots take
 * turns round-robin (a rotating subset is served each frame), so nobody starves.
 * Robots that start planning together (simulation start) are staggered: the first one served
 * may take the whole frame budget, the others get their share from the next frame on.
 */
export class PlanningScheduler {
  private frameKey: number | null = null;
  private remaining = 0;
  private share = 0;
  private requested = new Set<string>();
  private previous: string[] = [];
  private used = new Map<string, number>();
  private turn: Set<string> | null = null;
  private cursor = 0;
  private readonly totalMs: number;
  private readonly minShareMs: number;
  constructor(totalMs: number = IK_CONFIG.frameBudgetMs, minShareMs: number = IK_CONFIG.minRobotShareMs) {
    this.totalMs = totalMs;
    this.minShareMs = minShareMs;
  }
  private beginFrame(frameKey: number) {
    this.frameKey = frameKey;
    this.previous = [...this.requested];
    this.requested.clear();
    this.used.clear();
    this.remaining = this.totalMs;
    const contenders = Math.max(1, this.previous.length);
    const served = Math.max(1, Math.floor(this.totalMs / this.minShareMs));
    if (contenders > served) {
      // Too many planners for a useful share each: rotate which ones are served this frame.
      if (this.cursor >= contenders) this.cursor = 0;
      this.turn = new Set(Array.from({ length: served }, (_, i) => this.previous[(this.cursor + i) % contenders]));
      this.cursor = (this.cursor + served) % contenders;
      this.share = this.totalMs / served;
    } else {
      this.turn = null;
      this.share = this.totalMs / contenders;
    }
  }
  /** Allowance for robot `id` in the frame identified by `frameKey` (changes once per rendered frame). */
  budget(id: string, frameKey: number): PlanningBudget {
    if (frameKey !== this.frameKey) this.beginFrame(frameKey);
    return {
      take: (wanted, priority = false) => {
        if (frameKey !== this.frameKey) return 0;
        this.requested.add(id);
        // Robots that were not planning last frame join the rotation from the next frame.
        if (!priority && this.turn && !this.turn.has(id) && this.previous.includes(id)) return 0;
        const used = this.used.get(id) ?? 0;
        let granted = Math.max(0, Math.min(wanted, priority ? Infinity : this.share - used, this.remaining));
        if (granted < Math.min(wanted, MIN_SLICE_MS)) granted = 0;
        this.used.set(id, used + granted);
        this.remaining -= granted;
        return granted;
      },
      charge: (ms) => {
        if (frameKey !== this.frameKey || !(ms > 0)) return;
        this.used.set(id, (this.used.get(id) ?? 0) + ms);
        this.remaining -= ms;
      },
    };
  }
}

/** One scheduler for all robots rendered in the app. */
export const planningScheduler = new PlanningScheduler();
