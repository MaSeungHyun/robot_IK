import { Vector3 } from "three";

// Metres, seconds and radians unless explicitly stated otherwise.
export const BOX_BASE_SIZE = new Vector3(1, 1, 1);
export const PALLET_BASE_SIZE = new Vector3(1, 1, 1);
export const BOX_SIZES = [new Vector3(0.22, 0.2, 0.275)];
export const CONVEYOR_PATH = [
  new Vector3(1.0625, 0.25, -1.25),
  new Vector3(1.075, 0.25, -0.375),
  new Vector3(1.0625, 0.25, 0.375),
  new Vector3(1.0625, 0.25, 1.25),
];
/** Pallet stacking: full layers bottom-up; each layer fills far-to-near from its loading robot(s). */
export const PALLET_STACKING = {
  layers: 2,
  /** Hover/retreat stays this far (m) above the tallest placed box on the pallet. */
  clearance: 0.05,
};
export const STREAM_CONFIG = {
  robotScale: 0.5,
  palletHeight: 0.15,
  palletWidth: 1.1,
  palletDepth: 1.1,
  maxStackHeight: 5,
  center: new Vector3(-0.95, 0, 0),
  // The robot approaches the pallet from +X; fill the -X edge first.
  palletApproachDirection: new Vector3(1, 0, 0),
  speed: 0.0625,
  spacing: 0.5,
  pickupStartZ: -0.625,
  pickupEndZ: 0.375,
  pickupExpiryZ: 0.625,
  statsInterval: 0.5,
  palletGridOffset: 0.0006,
  palletExchangeDistance: 3.75,
  palletExchangeSpeed: 0.75,
};
// 55mm is the common lattice for 275mm and 220mm footprints on a 1.1m pallet.
export const PACKING = {
  cell: 0.055,
  epsilon: 1e-8,
  supportTolerance: 1e-6,
  tilingSearchStates: 3000,
};
export const MOTION = {
  maxDelta: 0.05,
  approachHeight: 0.0225,
  predictionSeconds: 0.12,
  trackingInterval: 0.2,
  retryInterval: 1,
  maxPlacementMotionRetries: 3,
  contactTolerance: 0.003125,
  approachTimeout: 15,
  movingContactHold: 0.03,
  contactHold: 0.15,
  liftClearance: 0.08125,
  destinationHoverClearance: 0.08,
  maxTransportHeight: 0.775,
  retreatHeight: 0.0375,
  angularSpeed: 1.8,
  baseAngularSpeed: 1.2,
  /** Joint acceleration limits (rad/s^2) for the synchronized trapezoid MoveJ profile. */
  angularAcceleration: 4.5,
  baseAngularAcceleration: 2.5,
};
// Radius is robot-local; waypoint clearances and speeds use world metres.
export const ROBOT_PICKING = {
  transferMode: "base" as const,
  radius: 3,
  preGraspHeight: 0.15,
  liftRearwardDistance: 0.5,
  rearLiftHeight: 0.4,
  transferPlanningBudgetMs: 1,
  prePlaceHeight: 0.15,
  retreatHeight: 0.15,
  verticalSpeed: 0.15,
  graspHoldSeconds: 0.12,
  releaseSeconds: 0.15,
  releaseAngularSpeed: Math.PI,
  loadedSpeedScale: 0.8,
  /** hand05 tool roll (about its local Y = tool shaft) travel limit, degrees either way from the export pose. */
  toolRollLimitDegrees: 180,
  /** Moving pickup: GripPoint within this distance (m) of the box grasp point counts as contact. */
  graspTolerance: 0.04,
  /** Horizontal part of graspTolerance (m): suction must stay over the box top. */
  graspHorizontalTolerance: 0.03,
  /** PRE_GRASP on a moving box hands over to analytic GRASP tracking within this distance (m) of the hover point. */
  trackHandoffTolerance: 0.06,
  /** PRE_GRASP intercept on a moving box: lead = latency + distance / tool speed, capped (s, m/s, s). */
  interceptLatency: 0.15,
  interceptToolSpeed: 1,
  interceptMaxLead: 1.5,
  /** Box selection: sim seconds from assignment to contact (approach + vertical descent); the box must still be in reach then. */
  pickLeadSeconds: 4,
  /** Box selection: predicted contact point must lie this far (m) inside the reach and before the belt end. */
  pickReachMargin: 0.15,
  /** PRE_GRASP gives the job back early when the box will leave the pickup radius within this many sim seconds. */
  abortLeadSeconds: 2,
  /**
   * PRE_GRASP on a moving box: once the planner has kept the arm waiting this many sim seconds (high playback
   * speed, many robots sharing the per-frame budget), approach with closed-form IK instead (re-solved every
   * approachResolveSeconds of sim time).
   */
  approachPlanTimeout: 0.4,
  approachResolveSeconds: 0.1,
};
export const COLLISION = {
  armBoxCollisions: false,
  carriedRobotCollisions: true,
  carriedConveyorBoxCollisions: false,
  restingTolerance: 0.00025,
  floorClearance: 0.001875,
  graspTopTolerance: 0.00625,
  graspEdgeInset: 0.00125,
  releaseOrientationToleranceDegrees: 1,
  rayMergeTolerance: 1e-5,
  rotationTolerance: 0.001,
  rotationStep: 0.015,
  cargoLiftClearance: 0.015,
};
export const IK_CONFIG = {
  wristTravelDegrees: [-180, 180] as const,
  // Planned motion only: the upper arm (hand01->hand02) must not pitch below horizontal toward the pallet/conveyor. Manual joint control stays unlimited.
  shoulderMinimumElevationDegrees: 0,
  /**
   * During pickup contact (GRASP/ATTACH/LIFT) the upper arm may dip this far below horizontal: a box passing close
   * to the base is otherwise unreachable and the robot hovers until the box leaves (missed pick).
   */
  contactShoulderMinimumElevationDegrees: -30,
  planningBudgetMs: 4,
  /**
   * Deterministic planning rate: generator steps a robot's planner may advance per second of SIM time. Planning
   * progress is tied to simulated time (never wall-clock ms), so outcomes do not depend on playback speed or CPU.
   */
  planningStepsPerSecond: 900,
  /** Same for the rear-transfer preparation that runs alongside LIFT. */
  transferPlanningStepsPerSecond: 300,
  // Rendered app: one IK planning budget per frame shared round-robin by the robots with pending plans.
  frameBudgetMs: 5,
  // Below this per-robot share the planners take turns instead of all getting a sliver.
  minRobotShareMs: 1,
  collisionSamplesPerSlice: 16,
  angularSample: 0.01,
  pathSamplesPerSecond: 60,
  placementWorldTiltToleranceDegrees: 5,
  /** Largest tool tilt (deg off vertical) the closed-form IK sweeps before numeric IK. */
  analyticMaxTiltDegrees: 20,
  // Locked hand03 limits orientation freedom; the wrist-above-cargo check remains mandatory.
  lockedRollTiltToleranceDegrees: 60,
  releaseWorldXDegrees: [-100, 80] as const,
  settledAngle: 0.002,
  settledBaseAngle: 0.002,
  cartesianSettledAngle: 1e-7,
  oppositeWristSpreadDegrees: 60,
  collisionRecoveryIterations: 2000,
  collisionEscapeDegrees: [5, 10, 20, 40] as const,
};
export const JOINT_SETTINGS = { lockHand3: true } as const;
export const NUMERICAL_IK = {
  iterations: 100,
  iterationsPerSlice: 4,
  initialDamping: 0.0001,
  minimumDamping: 1e-8,
  maximumDamping: 100,
  derivativeStep: 0.0001,
  maxJointStep: 0.25,
  orientationLength: 0.3,
  seedShoulderDegrees: [-120, -90, -45, 0, 45, 90, 120],
  seedElbowDegrees: [-150, -90, 0, 90, 150],
  seedRollDegrees: [0, 90, -90, 180],
  endpointCandidates: 12,
  cartesianStep: 0.04,
  routeIterations: 500,
  routeStep: 0.35,
  positionTolerance: 0.00015,
  planningArmClearance: 0.002,
  planningAngularSample: 0.005,
};
export const JOINT_LIMITS = {
  hand01: [-Infinity, Infinity],
  hand02: [-Infinity, Infinity],
} as const;

export const CLOSED_CHAIN_IK = {
  iterationsPerSlice: 3,
  maxSlices: 40,
  damping: 0.001,
  stallThreshold: 1e-7,
  translationStep: 0.1,
  rotationStep: 0.15,
  restPoseFactor: 0.001,
  goalToleranceScale: 0.5,
  rotationTolerance: 1e-5,
  coneSearchIterations: 12,
  coneCorrectionMargin: 0.001,
};
