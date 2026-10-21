import { THROUGHPUT_MIN_ELAPSED_S } from "@/constants/telemetry";
import type { EquipmentSnapshot } from "@/types/simulation";

export type LineMetrics = {
  throughputPerHour: number | undefined;
  availability: number | undefined;
  performance: number | undefined;
  quality: number | undefined;
  oee: number | undefined;
  bottleneck: { name: string; reason: string } | undefined;
  defectRate: number | undefined;
  palletFill: number | undefined;
};

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined);

/**
 * Line-wide KPIs derived from the live equipment snapshot (all ratios 0..100 %).
 * Approximations: availability = share of enabled robots/AMRs not blocked or waiting,
 * performance = mean robot utilization, quality = 1 - scanner fault rate,
 * bottleneck = busiest robot (highest utilization), or the AMR stuck longest when no robot is busy.
 */
export function computeLineMetrics(snapshot: EquipmentSnapshot | null, waitSeconds: Record<string, number> = {}): LineMetrics {
  const empty: LineMetrics = {
    throughputPerHour: undefined, availability: undefined, performance: undefined, quality: undefined,
    oee: undefined, bottleneck: undefined, defectRate: undefined, palletFill: undefined,
  };
  if (!snapshot) return empty;

  const processed = snapshot.robots.reduce((sum, robot) => sum + robot.count, 0);
  const throughputPerHour = snapshot.elapsed >= THROUGHPUT_MIN_ELAPSED_S ? (processed / snapshot.elapsed) * 3600 : undefined;

  const units = [
    ...snapshot.robots.map((robot) => robot.state),
    ...snapshot.agents.map((agent) => agent.state),
  ].filter((state) => state !== "disabled");
  const availability = units.length
    ? (units.filter((state) => state !== "blocked" && state !== "waiting").length / units.length) * 100 : undefined;

  const performance = average(snapshot.robots.filter((robot) => robot.state !== "disabled").map((robot) => robot.utilization));

  const scanned = snapshot.scanners?.reduce((sum, scanner) => sum + scanner.scanned, 0) ?? 0;
  const faults = snapshot.scanners?.reduce((sum, scanner) => sum + scanner.faults, 0) ?? 0;
  const defectRate = scanned ? (faults / scanned) * 100 : undefined;
  const quality = defectRate === undefined ? (snapshot.robots.length ? 100 : undefined) : 100 - defectRate;

  const oee = availability !== undefined && performance !== undefined && quality !== undefined
    ? (availability / 100) * (performance / 100) * (quality / 100) * 100 : undefined;

  const busiest = [...snapshot.robots].filter((robot) => robot.state !== "disabled").sort((a, b) => b.utilization - a.utilization)[0];
  const stuck = [...snapshot.agents].sort((a, b) => (waitSeconds[b.id] ?? 0) - (waitSeconds[a.id] ?? 0))[0];
  const stuckShare = stuck && snapshot.elapsed > 0 ? (waitSeconds[stuck.id] ?? 0) / snapshot.elapsed : 0;
  let bottleneck: LineMetrics["bottleneck"];
  if (stuck && stuckShare * 100 > (busiest?.utilization ?? 0)) {
    bottleneck = { name: stuck.name, reason: `대기 비율 ${Math.round(stuckShare * 100)}%` };
  } else if (busiest && busiest.utilization > 0) {
    bottleneck = { name: busiest.name, reason: `가동률 ${Math.round(busiest.utilization)}%` };
  }

  const capacity = snapshot.pallets.reduce((sum, pallet) => sum + pallet.capacity, 0);
  const palletFill = capacity ? (snapshot.pallets.reduce((sum, pallet) => sum + pallet.count, 0) / capacity) * 100 : undefined;

  return { throughputPerHour, availability, performance, quality, oee, bottleneck, defectRate, palletFill };
}
