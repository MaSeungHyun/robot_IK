export const AMR_CONFIG = {
  columns: 24, rows: 18, cellSize: .5,
  speed: 1, clearance: .08,
  taskInterval: 7, handlingSeconds: .8, statsInterval: .25,
  start: [2, 8] as const,
  dispatch: [2, 14] as const,
  pickups: [[8,3],[14,3],[20,3],[8,13],[14,13],[20,13]] as const,
  racks: [[6,5],[12,5],[18,5],[6,10],[12,10],[18,10]] as const,
  rackWidth: 1, rackDepth: 1,
};
