export type StreamStats = {
  spawned: number;
  placed: number;
  passed: number;
  live: number;
  utilization: number;
  full: boolean;
  size: string;
  palletNumber?: number;
  completedPallets?: number;
  exchanging?: boolean;
};
