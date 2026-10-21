import type { StreamStats } from "@/types/conveyor";
import type { RobotTransferMode } from "@/types/robot";

export type SimulatorRunProps = {
  running: boolean;
  transferMode: RobotTransferMode;
  onStats: (stats: StreamStats) => void;
  onProgress: (count: number, status: string) => void;
};
