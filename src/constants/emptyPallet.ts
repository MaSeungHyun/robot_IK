import { normalizeForkliftTask } from "@/constants/forkliftTask";
import type { EquipmentSettings } from "@/types/layout";

/** Empty-pallet flow defaults (absent settings = older layouts). */
export const EMPTY_PALLET_DEFAULTS = {
  /** Pallets an empty-pallet stack (palletSource dock) holds; beyond it stacked pallets leave the scene. */
  stackCapacity: 8,
  /** AMR self-unload at a scanner belt: seconds between boxes rolled off the deck. */
  deckFeedInterval: 1.6,
} as const;

type Settings = Partial<EquipmentSettings> | undefined;

/** Stack capacity (pallets, ≥ 1) of a palletSource dock. */
export const stackCapacityOf = (config: Settings) => Math.max(1, Math.round(config?.stackCapacity ?? EMPTY_PALLET_DEFAULTS.stackCapacity));
/** Deck-feed interval (s, ≥ 0.2) of a belt fed by an AMR self-unload. */
export const deckFeedIntervalOf = (config: Settings) => Math.max(0.2, config?.deckFeedInterval ?? EMPTY_PALLET_DEFAULTS.deckFeedInterval);
/** Belt allows AMR self-unload (default on). */
export const selfUnloadOf = (config: Settings) => config?.selfUnload ?? true;
/** AMR: a forklift always lifts its emptied pallet off and stacks it. The old "return" (return line) value was never
 * modelled; saved layouts with it are migrated to forklift recovery, so this is always true. */
export const emptyByForkliftOf = (_config: Settings) => true;
/** Forklift lifts empty pallets off AMRs onto the stack: palletSwap / mobileRack tasks (the cycle splits a pair by roleOf);
 * a legacy forklift without a task by its forkliftRole. */
export const takesEmptyPallets = (config: Settings) => {
  const task = config?.forkliftTask ? normalizeForkliftTask(config) : undefined;
  if (task) return task === "palletSwap" || task === "mobileRack";
  return (config?.forkliftRole ?? "auto") !== "unload";
};
/** Forklift also does the other (non empty-pallet) jobs: every task but palletSwap; legacy forklifts by forkliftRole. */
export const doesGeneralJobs = (config: Settings) => {
  if (config?.forkliftTask) return normalizeForkliftTask(config) !== "palletSwap";
  return !["supply", "emptyReturn"].includes(config?.forkliftRole ?? "auto");
};