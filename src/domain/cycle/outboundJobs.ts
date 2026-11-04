/**
 * Outbound (출하) jobs: one per stored pallet drawn for shipping. The rack forklift takes it out of the rack and hands it
 * over at a P&D (pick-and-drop) point near the rack, where the belt's outbound AMR is already waiting; the AMR carries it
 * to its ship conveyor. Kept as explicit, typed records with per-transition timestamps so a monitoring UI can list or
 * subscribe to them later.
 */

export const OUTBOUND_JOB_STATES = {
  created: "출하 지정",
  assigned: "설비 배정",
  forkliftPicking: "지게차 랙 출고",
  forkliftDelivering: "인계 지점으로 운반",
  handedOff: "AMR 인계 완료",
  amrDelivering: "출하 컨베이어로 운반",
  completed: "출하 완료",
  failed: "실패",
  cancelled: "취소",
} as const;
export type OutboundJobState = keyof typeof OUTBOUND_JOB_STATES;

/** Legal transitions; anything else is ignored (and logged by the registry's caller if needed). */
const NEXT: Record<OutboundJobState, readonly OutboundJobState[]> = {
  created: ["assigned", "cancelled", "failed"],
  assigned: ["forkliftPicking", "cancelled", "failed"],
  forkliftPicking: ["forkliftDelivering", "failed"],
  forkliftDelivering: ["handedOff", "completed", "failed"],
  handedOff: ["amrDelivering", "failed"],
  amrDelivering: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};
export const OUTBOUND_JOB_TERMINAL: readonly OutboundJobState[] = ["completed", "failed", "cancelled"];

/** Where the pallet changes hands: a P&D point near the rack (AMR flow), a stage dock (no AMR), or the AMR's belt wait pose (fallback). */
export type HandoffPoint = { id: string; kind: "rackPd" | "stage" | "beltWait"; x: number; z: number; yaw: number };

export type OutboundJob = {
  id: string;
  palletId: string | null;
  sourceRackId: string;
  sourceSlot: number;
  forkliftId: string | null;
  amrId: string | null;
  handoff: HandoffPoint | null;
  /** Ship conveyor (AMR flow) or stage dock (forklift-only flow). */
  shipConveyorId: string | null;
  state: OutboundJobState;
  /** AMR parked at the handoff point, waiting for the forklift (sim time, s). */
  amrAtHandoffAt: number | null;
  /** Sim time (s) each state was entered. */
  timestamps: Partial<Record<OutboundJobState, number>>;
  reason?: string;
};

export type OutboundJobEvent = { t: number; jobId: string; from: OutboundJobState | null; to: OutboundJobState | "amrAtHandoff"; job: Readonly<OutboundJob> };
export type OutboundJobListener = (event: OutboundJobEvent) => void;

const EVENT_LOG_LIMIT = 2000;

export class OutboundJobRegistry {
  private readonly jobs = new Map<string, OutboundJob>();
  private readonly listeners = new Set<OutboundJobListener>();
  private readonly log: OutboundJobEvent[] = [];
  private seq = 0;

  create(t: number, init: { palletId: string | null; sourceRackId: string; sourceSlot: number }): OutboundJob {
    const job: OutboundJob = {
      id: `OUT-${String(++this.seq).padStart(4, "0")}`,
      ...init,
      forkliftId: null,
      amrId: null,
      handoff: null,
      shipConveyorId: null,
      state: "created",
      amrAtHandoffAt: null,
      timestamps: { created: t },
    };
    this.jobs.set(job.id, job);
    this.emit({ t, jobId: job.id, from: null, to: "created", job });
    return job;
  }

  /** Moves a job to `to` (only along NEXT); `patch` fills the assignment fields. Returns false on an illegal transition. */
  transition(t: number, id: string, to: OutboundJobState, patch: Partial<Pick<OutboundJob, "forkliftId" | "amrId" | "handoff" | "shipConveyorId" | "reason">> = {}) {
    const job = this.jobs.get(id);
    if (!job || !NEXT[job.state].includes(to)) return false;
    const from = job.state;
    Object.assign(job, patch);
    job.state = to;
    job.timestamps[to] = t;
    this.emit({ t, jobId: id, from, to, job });
    return true;
  }

  /** AMR reached the handoff point (not a state of its own: the forklift may still be picking). */
  amrArrived(t: number, id: string) {
    const job = this.jobs.get(id);
    if (!job || job.amrAtHandoffAt !== null || OUTBOUND_JOB_TERMINAL.includes(job.state)) return;
    job.amrAtHandoffAt = t;
    this.emit({ t, jobId: id, from: job.state, to: "amrAtHandoff", job });
  }

  get(id: string): Readonly<OutboundJob> | undefined {
    return this.jobs.get(id);
  }
  list(filter?: (job: Readonly<OutboundJob>) => boolean): Readonly<OutboundJob>[] {
    const all = [...this.jobs.values()];
    return filter ? all.filter(filter) : all;
  }
  active() {
    return this.list((job) => !OUTBOUND_JOB_TERMINAL.includes(job.state));
  }
  /** Most recent transitions, oldest first (capped). */
  events(): readonly OutboundJobEvent[] {
    return this.log;
  }
  subscribe(listener: OutboundJobListener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: OutboundJobEvent) {
    this.log.push(event);
    if (this.log.length > EVENT_LOG_LIMIT) this.log.splice(0, this.log.length - EVENT_LOG_LIMIT);
    for (const listener of this.listeners) listener(event);
  }
}
