import { CONVEYOR_LAYOUT } from "@/constants/conveyorLayoutConfig";
import { PRODUCTION_LINE } from "@/constants/productionLine";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { beltConnections, beltLength, beltPoint, connectedBeltIds } from "@/domain/conveyor/conveyorLayout";
import type { EquipmentSettings, SceneEquipment } from "@/types/layout";

export type ProductionLine = {
  /** Stable derived id: `line-<start segment id>`. */
  id: string;
  /** Default display name in start-segment order: 라인 1, 라인 2 ... */
  name: string;
  startBeltId: string;
  beltIds: string[];
  robotIds: string[];
  scannerIds: string[];
  palletIds: string[];
};

type Point = { x: number; z: number };

function beltSamples(belt: SceneEquipment): Point[] {
  const length = beltLength(belt);
  return Array.from({ length: CONVEYOR_LAYOUT.samples + 1 }, (_, index) => beltPoint(belt, (length * index) / CONVEYOR_LAYOUT.samples));
}

const nearest = (point: Point, samples: Point[]) =>
  samples.reduce((best, sample) => Math.min(best, Math.hypot(sample.x - point.x, sample.z - point.z)), Infinity);

/**
 * Production lines derived from conveyor chains. A line starts at a segment nothing feeds into (the box inlet)
 * and contains every segment connected to it. Robots join the line whose belt centerline comes closest within
 * their pick reach (the simulator picks boxes from belts within `reach`); scanners join the line whose belt they
 * sit on; pallets join the line of a robot that can reach them.
 */
export function deriveProductionLines(objects: SceneEquipment[], settings: Record<string, EquipmentSettings>): ProductionLine[] {
  const belts = objects.filter((object) => object.kind === "conveyor");
  const { incoming } = beltConnections(objects);
  const starts = belts.filter((belt) => !incoming.has(belt.id));

  const lines = starts.map((start, index) => {
    const ids = connectedBeltIds(objects, start.id);
    const chain = belts.filter((belt) => ids.has(belt.id));
    return {
      line: {
        id: `line-${start.id}`, name: `라인 ${index + 1}`, startBeltId: start.id,
        beltIds: chain.map((belt) => belt.id), robotIds: [] as string[], scannerIds: [] as string[], palletIds: [] as string[],
      },
      samples: chain.flatMap(beltSamples),
    };
  });

  for (const object of objects) {
    if (object.kind !== "robot" && object.kind !== "scanner") continue;
    const limit = object.kind === "robot"
      ? (settings[object.id]?.reach ?? SIMULATOR_CONFIG.reach)
      : PRODUCTION_LINE.scannerSnapDistance;
    let best: (typeof lines)[number] | undefined, bestDistance = limit;
    for (const entry of lines) {
      const distance = nearest(object, entry.samples);
      if (distance <= bestDistance) [best, bestDistance] = [entry, distance];
    }
    if (best) (object.kind === "robot" ? best.line.robotIds : best.line.scannerIds).push(object.id);
  }

  for (const pallet of objects.filter((object) => object.kind === "pallet")) {
    const owner = lines.find(({ line }) => line.robotIds.some((id) => {
      const robot = objects.find((object) => object.id === id);
      return robot && Math.hypot(robot.x - pallet.x, robot.z - pallet.z) <= (settings[id]?.reach ?? SIMULATOR_CONFIG.reach);
    }));
    owner?.line.palletIds.push(pallet.id);
  }

  return lines.map(({ line }) => line);
}
