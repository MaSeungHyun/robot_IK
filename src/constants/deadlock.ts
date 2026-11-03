/** Deadlock / starvation guards (FactorySimulator.advanceGuards). */
export const RESERVATION_WATCHDOG = {
  /** A vehicle holding a dock / rail booking that stays within `radius` m for this long (s) loses it and is requeued. */
  timeout: 60,
  radius: 0.5,
};
export const WAIT_FOR_GRAPH = {
  /** A vehicle counts as waiting after this long (s) without leaving WAIT radius (RESERVATION_WATCHDOG.radius). */
  minWait: 6,
  /** An AMR waits on the nearest other vehicle whose centre is within this distance (m). */
  reach: 3.5,
  /** Seconds between cycle checks, and before the same vehicle is told to evade again. */
  interval: 1,
  cooldown: 15,
};
export const BATTERY_GUARD = {
  /** Below this % a moving AMR's bookings are released early and it charges as soon as it is empty (pallets are never dropped). */
  forceBelow: 5,
};
