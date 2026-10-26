/** First-person walk (person view) parameters. Lengths in m, speeds in m/s, rates in 1/s. */

/** Standing height of the walker. */
export const PERSON_HEIGHT = 2.5;
/** Camera (eye) height: about 10 cm below the top of the head. */
export const PERSON_EYE_HEIGHT = PERSON_HEIGHT - 0.1;
/** Vertical field of view (deg) while walking; the orbit camera's FOV is restored on exit. */
export const WALK_FOV = 65;
/** Walking speed. */
export const WALK_SPEED = 3.5;
/** Shift (run) speed multiplier. */
export const RUN_MULTIPLIER = 2.2;
/** Velocity smoothing toward the input direction while a key is held. */
export const WALK_ACCELERATION = 10;
/** Velocity decay when no key is held (stopping ease). */
export const WALK_DAMPING = 8;
/** Mouse look sensitivity (rad per pixel). */
export const MOUSE_SENSITIVITY = 0.0022;
/** Pitch limit (rad). */
export const MAX_PITCH = Math.PI / 2 - 0.05;
/** Head bob at walking speed: vertical amplitude, side sway, roll (rad); scaled by speed. */
export const HEAD_BOB_AMPLITUDE = {
  height: 0.035,
  sway: 0.025,
  roll: 0.006,
} as const;
/** Head bob frequency: one step per this many metres travelled. */
export const HEAD_BOB_STRIDE = 1.4;
/** Walker body radius for collisions. */
export const PERSON_COLLISION_RADIUS = 0.3;
