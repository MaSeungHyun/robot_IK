/**
 * Pallet transport tasks: a full pallet station creates a task (FIFO), fleet dispatch assigns an
 * AMR, and the task completes once the pallet is on its dock or in its rack slot.
 * Event-shaped so a live FMS feed could drive the same records later.
 */
export type TransportTaskState = "queued" | "assigned" | "done";

export type TransportTask = {
  id: string;
  stationId: string;
  palletId?: string;
  createdAt: number;
  state: TransportTaskState;
  agentId?: string;
  destinationId?: string;
  assignedAt?: number;
  doneAt?: number;
};

const KEEP_DONE = 200;

export class TransportQueue {
  private tasks: TransportTask[] = [];
  private next = 1;

  /** Open (queued) task for a station, creating it the first time the pallet is reported full. */
  request(e: { t: number; stationId: string; palletId?: string }) {
    const open = this.tasks.find((task) => task.stationId === e.stationId && task.state === "queued");
    if (open) return open;
    const task: TransportTask = { id: `T-${String(this.next++).padStart(4, "0")}`, stationId: e.stationId, palletId: e.palletId, createdAt: e.t, state: "queued" };
    this.tasks.push(task);
    return task;
  }
  /** Queued tasks, oldest first. */
  queued() {
    return this.tasks.filter((task) => task.state === "queued");
  }
  assign(e: { t: number; taskId: string; agentId: string; destinationId: string }) {
    const task = this.tasks.find((entry) => entry.id === e.taskId);
    if (!task || task.state !== "queued") return;
    Object.assign(task, { state: "assigned", agentId: e.agentId, destinationId: e.destinationId, assignedAt: e.t });
  }
  /** The assigned task of `agentId` for `stationId` is finished. */
  complete(e: { t: number; stationId: string; agentId: string }) {
    const task = this.tasks.find((entry) => entry.state === "assigned" && entry.stationId === e.stationId && entry.agentId === e.agentId);
    if (!task) return;
    task.state = "done";
    task.doneAt = e.t;
    const done = this.tasks.filter((entry) => entry.state === "done");
    if (done.length > KEEP_DONE) this.tasks.splice(this.tasks.indexOf(done[0]), 1);
  }
  list(): readonly TransportTask[] {
    return this.tasks;
  }
}