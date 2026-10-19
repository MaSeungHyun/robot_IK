import { AMR_CONFIG as C } from "@/constants/amr";
import { findPath } from "@/utils/amr/pathfinding";
import type { Cell, NavigationGrid } from "@/utils/amr/pathfinding";
import type { StreamStats } from "@/types/conveyor";

export function cellPosition([x, z]: Cell): [number, number, number] {
  return [
    (x - C.columns / 2 + 0.5) * C.cellSize,
    0,
    (z - C.rows / 2 + 0.5) * C.cellSize,
  ];
}

export function createWarehouseGrid(): NavigationGrid {
  const blocked = new Set<number>();
  const radius = C.bodyWidth / 2 + C.clearance;
  for (let z = 0; z < C.rows; z++)
    for (let x = 0; x < C.columns; x++) {
      if (
        C.racks.some(
          ([rx, rz]) =>
            Math.abs(x - rx) * C.cellSize < C.rackWidth / 2 + radius &&
            Math.abs(z - rz) * C.cellSize < C.rackDepth / 2 + radius,
        )
      )
        blocked.add(z * C.columns + x);
    }
  return { columns: C.columns, rows: C.rows, blocked };
}

type Phase =
  | "idle"
  | "pickup"
  | "loading"
  | "dispatch"
  | "unloading"
  | "blocked";
export class AMRSimulator {
  readonly grid = createWarehouseGrid();
  cell: Cell = C.start;
  path: Cell[] = [];
  pathVersion = 0;
  cursor = 0;
  segment = 0;
  phase: Phase = "idle";
  carrying = false;
  x = cellPosition(C.start)[0];
  z = cellPosition(C.start)[2];
  yaw = 0;
  spawned = 0;
  completed = 0;
  queue: Cell[] = [];
  private elapsed = 0;
  private spawnElapsed = C.taskInterval;
  private taskIndex = 0;

  private route(goal: Cell, phase: Phase) {
    const path = findPath(this.grid, this.cell, goal);
    if (!path) {
      this.phase = "blocked";
      return;
    }
    this.path = path;
    this.cursor = 0;
    this.segment = 0;
    this.phase = phase;
    this.pathVersion++;
  }
  advance(delta: number) {
    this.spawnElapsed += delta;
    if (this.spawnElapsed >= C.taskInterval) {
      this.spawnElapsed -= C.taskInterval;
      this.queue.push(C.pickups[this.taskIndex++ % C.pickups.length]);
      this.spawned++;
    }
    if (this.phase === "idle" && this.queue.length)
      this.route(this.queue.shift()!, "pickup");
    if (this.phase === "loading" || this.phase === "unloading") {
      this.elapsed += delta;
      if (this.elapsed >= C.handlingSeconds) {
        this.elapsed = 0;
        if (this.phase === "loading") {
          this.carrying = true;
          this.route(C.dispatch, "dispatch");
        } else {
          this.carrying = false;
          this.completed++;
          this.phase = "idle";
          this.path = [];
          this.pathVersion++;
        }
      }
      return;
    }
    if (this.phase !== "pickup" && this.phase !== "dispatch") return;
    this.segment += (delta * C.speed) / C.cellSize;
    while (this.segment >= 1 && this.cursor < this.path.length - 1) {
      this.segment--;
      this.cell = this.path[++this.cursor];
    }
    if (this.cursor === this.path.length - 1) {
      this.x = (this.cell[0] - C.columns / 2 + 0.5) * C.cellSize;
      this.z = (this.cell[1] - C.rows / 2 + 0.5) * C.cellSize;
      this.phase = this.phase === "pickup" ? "loading" : "unloading";
      this.elapsed = 0;
      return;
    }
    const from = this.path[this.cursor],
      to = this.path[this.cursor + 1];
    this.x =
      (from[0] + (to[0] - from[0]) * this.segment - C.columns / 2 + 0.5) *
      C.cellSize;
    this.z =
      (from[1] + (to[1] - from[1]) * this.segment - C.rows / 2 + 0.5) *
      C.cellSize;
    const target = Math.atan2(to[0] - from[0], to[1] - from[1]);
    const turn = Math.atan2(
      Math.sin(target - this.yaw),
      Math.cos(target - this.yaw),
    );
    this.yaw += turn * Math.min(1, delta * 10);
  }
  get status() {
    return {
      idle: "다음 작업 대기",
      pickup: "픽업 지점으로 이동",
      loading: "화물 상차 중",
      dispatch: "출고 지점으로 이동",
      unloading: "화물 하차 중",
      blocked: "이동 가능한 경로가 없습니다",
    }[this.phase];
  }
  get stats(): StreamStats {
    return {
      spawned: this.spawned,
      placed: this.completed,
      passed: 0,
      live: this.phase === "idle" ? 0 : 1,
      completedPallets: this.completed,
      utilization: 0,
      full: false,
      size: "",
    };
  }
}
