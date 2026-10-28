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
/** Forklift role allows lifting empty pallets off AMRs onto the stack. */
export const takesEmptyPallets = (config: Settings) => (config?.forkliftRole ?? "auto") !== "unload";
/** Forklift role allows the other (non empty-return) jobs. */
export const doesGeneralJobs = (config: Settings) => !["supply", "emptyReturn"].includes(config?.forkliftRole ?? "auto");