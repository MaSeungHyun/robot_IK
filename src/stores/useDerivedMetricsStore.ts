import { create } from "zustand";
import { PRODUCTION_LINE } from "@/constants/productionLine";
import { AMR_WAIT_STATES, CHARGE_RATE_TAU_S } from "@/constants/telemetry";
import { smoothingAlpha } from "@/lib/interpolation";
import { useSimulationStore } from "@/stores/useSimulationStore";

/** Simulated seconds a robot spent processing (at the box/pallet), transferring a box, or waiting idle. */
export type RobotTimeShare = { processing: number; transfer: number; wait: number };
/** Robot processed-count sample for rolling production-rate charts. */
export type CountSample = { t: number; counts: Record<string, number> };

type AgentHistory = { waitSeconds: number; battery: number; chargeRate: number | undefined };

/**
 * Display-only metrics accumulated from successive equipment snapshots (simulation seconds):
 * AMR waiting/blocked time, estimated charge rate, and cumulative energy integrated from reported power.
 * Resets whenever the snapshot disappears or simulated time goes backwards (STOP / new run).
 */
export const useDerivedMetricsStore = create<{
  elapsed: number;
  energyKWh: number;
  agents: Record<string, AgentHistory>;
  robots: Record<string, RobotTimeShare>;
  history: CountSample[];
}>(() => ({ elapsed: 0, energyKWh: 0, agents: {}, robots: {}, history: [] }));

const isWaiting = (state: string) => (AMR_WAIT_STATES as readonly string[]).includes(state);

useSimulationStore.subscribe((state, previous) => {
  if (state.equipment === previous.equipment) return;
  const equipment = state.equipment;
  const last = useDerivedMetricsStore.getState();
  if (!equipment || equipment.elapsed < last.elapsed) {
    useDerivedMetricsStore.setState({ elapsed: equipment?.elapsed ?? 0, energyKWh: 0, agents: {}, robots: {}, history: [] });
    return;
  }
  const dt = equipment.elapsed - last.elapsed;
  if (dt <= 0) return;

  const telemetry = { ...state.mockTelemetry, ...equipment.telemetry };
  const powerKw = Object.values(telemetry).reduce((sum, reading) => sum + (reading?.powerKw ?? 0), 0);

  const agents: Record<string, AgentHistory> = {};
  for (const agent of equipment.agents) {
    const before = last.agents[agent.id];
    const battery = telemetry[agent.id]?.batteryPercent ?? agent.battery;
    let chargeRate = before?.chargeRate;
    if (agent.state === "charging" && before && Number.isFinite(battery)) {
      const rate = (battery - before.battery) / dt;
      if (rate > 0) chargeRate = chargeRate === undefined ? rate : chargeRate + (rate - chargeRate) * smoothingAlpha(dt, CHARGE_RATE_TAU_S);
    }
    agents[agent.id] = {
      waitSeconds: (before?.waitSeconds ?? 0) + (isWaiting(agent.state) ? dt : 0),
      battery,
      chargeRate,
    };
  }

  const robots: Record<string, RobotTimeShare> = {};
  for (const robot of equipment.robots) {
    const share = { ...(last.robots[robot.id] ?? { processing: 0, transfer: 0, wait: 0 }) };
    const phase = robot.status.split("·")[0].trim();
    if (robot.state === "working") {
      if ((PRODUCTION_LINE.transferPhases as readonly string[]).includes(phase)) share.transfer += dt;
      else share.processing += dt;
    } else if (robot.state === "idle") share.wait += dt;
    robots[robot.id] = share;
  }

  let history = last.history;
  const previousSample = history[history.length - 1];
  if (!previousSample || equipment.elapsed - previousSample.t >= PRODUCTION_LINE.historyStepS) {
    const counts: Record<string, number> = {};
    for (const robot of equipment.robots) counts[robot.id] = robot.count;
    history = [...history, { t: equipment.elapsed, counts }].slice(-(PRODUCTION_LINE.historyLength + 1));
  }

  useDerivedMetricsStore.setState({ elapsed: equipment.elapsed, energyKWh: last.energyKWh + (powerKw * dt) / 3600, agents, robots, history });
});
