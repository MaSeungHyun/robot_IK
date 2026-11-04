import type { EquipmentPose, SceneEquipment } from "@/types/layout";
import { beltLength, beltLocalPoint } from "@/domain/conveyor/conveyorLayout";
import { SCAN_TUNNEL_MODEL as T } from "@/constants/modelPoints.generated";
import { SCANNER_FLOW_YAW } from "@/constants/conveyorLayoutConfig";

/**
 * Line snapping (editor): a conveyor or scanner placed/dropped with one of its ends near a free end of another
 * conveyor/scanner (output -> input) snaps so the ends meet exactly (position + heading): beltConnections /
 * withScannerBelts then link them (the spline flow continues).
 */
/** Max distance (m) between the two ends for a snap. */
export const LINE_SNAP_RADIUS = 1.5;
/** Max heading difference (rad) between the two ends for a snap (60°). */
export const LINE_SNAP_ANGLE = Math.PI / 3;
/** Two ends closer than this (and aligned) are already joined. */
const JOINED = 0.05;

type Port = { x: number; z: number; yaw: number };
const isLine = (o: SceneEquipment) => (o.kind === "conveyor" || o.kind === "scanner") && !o.id.startsWith("scanbelt:");

/** Input (flow start) / output (flow end) of a line object, in its local frame. */
function localPorts(o: SceneEquipment): { input: Port; output: Port } | null {
  if (o.kind === "conveyor") return { input: beltLocalPoint(o, 0), output: beltLocalPoint(o, beltLength(o)) };
  if (o.kind === "scanner")
    // Mesh faces (not the shorter belt span) so a snapped rail meets the visible tunnel end; still inside the 1 m scanbelt join radius.
    return { input: { x: 0, z: T.max[2], yaw: SCANNER_FLOW_YAW }, output: { x: 0, z: T.min[2], yaw: SCANNER_FLOW_YAW } };
  return null;
}
const toWorld = (o: EquipmentPose, p: Port): Port => {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  return { x: o.x + p.x * c + p.z * s, z: o.z - p.x * s + p.z * c, yaw: o.yaw + p.yaw };
};
const angleBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const joined = (a: Port, b: Port) => Math.hypot(a.x - b.x, a.z - b.z) < JOINED && angleBetween(a.yaw, b.yaw) < 0.05;

/** `object` moved so its nearest end joins a free end of another conveyor/scanner, or unchanged. */
export function snapLine(object: SceneEquipment, objects: readonly SceneEquipment[]): SceneEquipment {
  const mine = localPorts(object);
  if (!mine || !isLine(object)) return object;
  const others = objects.filter((o) => o.id !== object.id && isLine(o));
  const ports = others.map((o) => { const p = localPorts(o)!; return { id: o.id, input: toWorld(o, p.input), output: toWorld(o, p.output) }; });
  // An end is free when no third object's opposite end already sits on it.
  const taken = (port: Port, owner: string, side: "input" | "output") =>
    ports.some((p) => p.id !== owner && joined(side === "output" ? p.input : p.output, port));
  let best = LINE_SNAP_RADIUS, result = object;
  for (const other of ports)
    for (const side of ["input", "output"] as const) {
      // My input meets their output, my output meets their input.
      const local = side === "input" ? mine.input : mine.output, target = side === "input" ? other.output : other.input;
      if (taken(target, other.id, side === "input" ? "output" : "input")) continue;
      const current = toWorld(object, local), distance = Math.hypot(current.x - target.x, current.z - target.z);
      if (distance >= best || angleBetween(current.yaw, target.yaw) > LINE_SNAP_ANGLE) continue;
      const yaw = target.yaw - local.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
      result = { ...object, x: target.x - local.x * c - local.z * s, z: target.z + local.x * s - local.z * c, yaw };
      best = distance;
    }
  return result;
}