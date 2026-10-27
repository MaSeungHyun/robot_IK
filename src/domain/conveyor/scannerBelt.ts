/**
 * ScanTunnel.glb carries its own belt (SCAN_TUNNEL_MODEL.beltZ, flow +z). A scanner that does not stand over a
 * rail (the factory.glb layout: scanner as the start of a line) gets that belt as a simulation-only conveyor
 * (never rendered; the tunnel model already shows it). It joins the line like a rail:
 *  - a rail whose end lies at the tunnel entry (within JOIN_REACH, same heading) feeds into it,
 *  - a rail starting at the tunnel exit continues it (see `scannerOutletPose` for laying one).
 * No feeding rail and no depalletizer at its entry -> the scanner is the flow start and spawns boxes itself.
 */
import { SCAN_TUNNEL_MODEL as T } from "@/constants/modelPoints.generated";
import { CONVEYOR_LAYOUT as C } from "@/constants/conveyorLayoutConfig";
import { beltLength, beltPoint } from "@/domain/conveyor/conveyorLayout";
import type { EquipmentPose, EquipmentSettings, SceneEquipment } from "@/types/layout";

/** A rail end/start this close to the tunnel entry/exit (and heading the same way) joins the tunnel belt. */
export const SCANNER_JOIN_REACH = 1.0;
const ON_RAIL = 1.0;
export const scannerBeltId = (scannerId: string) => `scanbelt:${scannerId}`;
export const isScannerBelt = (id: string) => id.startsWith("scanbelt:");

const local = (pose: EquipmentPose, z: number) => ({ x: pose.x + Math.sin(pose.yaw) * z, z: pose.z + Math.cos(pose.yaw) * z, yaw: pose.yaw });
/** Tunnel belt entry / exit (world, at scanner yaw). */
export const scannerEntry = (scanner: EquipmentPose) => local(scanner, T.beltZ[0]);
export const scannerExit = (scanner: EquipmentPose) => local(scanner, T.beltZ[1]);
/** Pose of a straight rail.glb (native length) starting at the tunnel exit. */
export function scannerOutletPose(scanner: EquipmentPose): EquipmentPose {
  return local(scanner, T.beltZ[1] + C.length / 2);
}

const aligned = (a: number, b: number) => Math.cos(a - b) > 0.98;
const near = (a: { x: number; z: number }, b: { x: number; z: number }, r: number) => Math.hypot(a.x - b.x, a.z - b.z) <= r;

/** True when a real conveyor runs under the scanner (classic layout: tunnel over the rail start). */
function onRail(scanner: SceneEquipment, belts: SceneEquipment[]) {
  return belts.some((belt) => {
    const length = beltLength(belt);
    for (let d = 0; d <= length; d += 0.25) if (near(beltPoint(belt, d), scanner, ON_RAIL)) return true;
    return false;
  });
}

/**
 * Adds the tunnel belts of free-standing scanners to the simulated objects and gives them settings
 * (enabled with the scanner; auto spawn when the scanner starts the flow). Belt ends snap exactly onto a
 * joining rail so beltConnections links them.
 */
export function withScannerBelts(objects: SceneEquipment[], getSettings: () => Record<string, EquipmentSettings>) {
  const belts = objects.filter((o) => o.kind === "conveyor");
  const extra: SceneEquipment[] = [];
  const starts = new Map<string, boolean>();
  const base = getSettings();
  for (const scanner of objects) {
    if (scanner.kind !== "scanner" || onRail(scanner, belts)) continue;
    let start = scannerEntry(scanner), end = scannerExit(scanner);
    const feeder = belts.find((b) => { const e = beltPoint(b, beltLength(b)); return aligned(e.yaw, scanner.yaw) && near(e, start, SCANNER_JOIN_REACH); });
    if (feeder) { const e = beltPoint(feeder, beltLength(feeder)); start = { x: e.x, z: e.z, yaw: scanner.yaw }; }
    const outlet = belts.find((b) => { const s = beltPoint(b, 0); return aligned(s.yaw, scanner.yaw) && near(s, end, SCANNER_JOIN_REACH); });
    if (outlet) { const s = beltPoint(outlet, 0); end = { x: s.x, z: s.z, yaw: scanner.yaw }; }
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    const depalletizer = objects.some((o) => o.kind === "robot" && base[o.id]?.robotRole === "depalletize" && Math.min(...[0, 0.5, 1].map((f) => Math.hypot(o.x - (start.x + (end.x - start.x) * f), o.z - (start.z + (end.z - start.z) * f)))) <= (base[o.id]?.reach ?? 2.5) + 1);
    starts.set(scanner.id, !feeder && !depalletizer);
    extra.push({ id: scannerBeltId(scanner.id), kind: "conveyor", name: `${scanner.name} 벨트`, x: (start.x + end.x) / 2, z: (start.z + end.z) / 2, yaw: scanner.yaw, conveyorLength: length });
  }
  if (!extra.length) return { objects, getSettings };
  let last: Record<string, EquipmentSettings> | null = null, merged: Record<string, EquipmentSettings> = {};
  const wrapped = () => {
    const current = getSettings();
    if (current === last) return merged;
    last = current;
    merged = { ...current };
    for (const belt of extra) {
      const scannerId = belt.id.slice("scanbelt:".length), scanner = current[scannerId];
      merged[belt.id] = { speed: 1, reach: 0, capacity: 40, spawnInterval: 8, ...(scanner?.beltSpeed ? { beltSpeed: scanner.beltSpeed } : {}), enabled: scanner?.enabled !== false, autoSpawn: starts.get(scannerId) ?? false };
    }
    return merged;
  };
  return { objects: [...objects, ...extra], getSettings: wrapped };
}