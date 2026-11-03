/**
 * Generic animated-parts channel (recording). Any device exposes its moving sub-parts through getAnimatedParts():
 * one entry per (deviceId, partName, channel), with the value in the local space of that GLB node (metres, radians),
 * so a viewer can set node.position / rotation / quaternion directly. New device types only implement the interface;
 * the exporter (scripts/record-run.mjs) records whatever the registry returns. See docs/sim-recording.md.
 */
export type AnimatedChannel = "posX" | "posY" | "posZ" | "rotX" | "rotY" | "rotZ" | "quat" | "fraction" | "speed";
export type AnimatedValue = number | number[];

export type AnimatedPart = {
  deviceId: string;
  /** Device kind (forklift, agv, transfer, door, conveyor, robot, ...). */
  kind: string;
  /** GLB node name (as authored; GLTFLoader may strip "." e.g. `Forklift.Fork` -> `ForkliftFork`), or a procedural part name. */
  partName: string;
  channel: AnimatedChannel;
  unit: string;
  value: AnimatedValue;
  /** Value at rest / as authored (null = not known up front). */
  rest: AnimatedValue | null;
  /** Minimum change that is recorded (channel units; quat: rotation angle in rad). */
  threshold: number;
  /** Not a GLB node: a part the viewer builds itself (stopper boxes, door curtain, belt surface). */
  procedural?: boolean;
  /** Parent of the part when it is not directly under the device root. */
  parent?: string;
  /** Static local position of a procedural part (m), for viewers that rebuild it. */
  restPos?: number[];
};

/** Implemented by every controller / domain object that animates sub-parts. */
export interface AnimatedPartSource {
  getAnimatedParts(): AnimatedPart[];
}

const ROT = 0.00175; // ~0.1 deg
export const PART_THRESHOLDS: Record<AnimatedChannel, number> = { posX: 0.001, posY: 0.001, posZ: 0.001, rotX: ROT, rotY: ROT, rotZ: ROT, quat: ROT, fraction: 0.005, speed: 0.001 };
export const PART_UNITS: Record<AnimatedChannel, string> = { posX: "m", posY: "m", posZ: "m", rotX: "rad", rotY: "rad", rotZ: "rad", quat: "quaternion [x,y,z,w] local", fraction: "0..1", speed: "m/s" };
const DIGITS: Record<AnimatedChannel, number> = { posX: 4, posY: 4, posZ: 4, rotX: 4, rotY: 4, rotZ: 4, quat: 4, fraction: 3, speed: 3 };

export const roundPart = (channel: AnimatedChannel, v: AnimatedValue): AnimatedValue => {
  const f = 10 ** DIGITS[channel], r = (x: number) => Math.round(x * f) / f || 0;
  return Array.isArray(v) ? v.map(r) : r(v);
};

export function animatedPart(deviceId: string, kind: string, partName: string, channel: AnimatedChannel, value: AnimatedValue, rest: AnimatedValue | null,
  extra: Partial<Pick<AnimatedPart, "procedural" | "parent" | "restPos" | "threshold">> = {}): AnimatedPart {
  return { deviceId, kind, partName, channel, unit: PART_UNITS[channel], value: roundPart(channel, value), rest: rest === null ? null : roundPart(channel, rest), threshold: PART_THRESHOLDS[channel], ...extra };
}

export const partKey = (p: Pick<AnimatedPart, "deviceId" | "partName" | "channel">) => `${p.deviceId}|${p.partName}|${p.channel}`;

/** Change between two values in channel units (quat: rotation angle in rad). */
export function partDelta(channel: AnimatedChannel, a: AnimatedValue, b: AnimatedValue): number {
  if (channel === "quat") {
    const x = a as number[], y = b as number[], d = Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2] + x[3] * y[3]) / (Math.hypot(...x) * Math.hypot(...y) || 1); // rounded quats are not unit
    return 2 * Math.acos(Math.min(1, d));
  }
  return Math.abs((a as number) - (b as number));
}
