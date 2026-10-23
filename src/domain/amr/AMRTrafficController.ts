import { Vector3 } from "three";
import { AMR_TRAFFIC } from "@/constants/simulatorLayout";
import type { PalletDispatchController } from "@/domain/amr/PalletDispatchController";

type Vehicle = {
  id: string;
  dispatch: PalletDispatchController;
  speed: number;
  enabled: boolean;
};
type Motion = {
  next: Vector3;
  ahead: Vector3;
  allowed: boolean;
  wait: number;
  retry: number;
  /** Vehicle this one stepped aside for; it holds at the side cell until that one has passed. */
  yieldFrom: string | null;
  hold: number;
};
/** Plans from the vehicle to `target` (default: its goal), treating the other AMRs as temporary obstacles. */
export type TrafficPlanner = (
  vehicle: Vehicle,
  target?: Vector3,
) => Vector3[] | null;

export const TRAFFIC_RESOLUTION = {
  /** Waiting this long (s) without a usable detour counts as a deadlock. */
  deadlock: 1.6,
  /** Winner path length (m) a yielding vehicle must clear. */
  corridor: 5,
  /** Distances (m) and directions tried for the side cell. */
  rings: [0.6, 1, 1.5, 2, 2.6, 3.3],
  angles: 16,
  attempts: 14,
  /** Holding longer than this (s) resumes even if the winner is still near. */
  maxHold: 10,
  /** Straight back-off distances (m) tried when no side cell is reachable. */
  reverse: [1.2, 0.8, 0.5],
  /** Speed factor while reversing. */
  reverseSpeed: 0.5,
  /** Seconds a vehicle that backed off for a forklift waits before replanning. */
  bodyHold: 2,
};

// Closest separation of two swept discs, including crossings between frames.
function separation(a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
  const x = a.x - c.x,
    z = a.z - c.z,
    dx = b.x - a.x - d.x + c.x,
    dz = b.z - a.z - d.z + c.z;
  const length = dx * dx + dz * dz,
    t = length ? Math.max(0, Math.min(1, -(x * dx + z * dz) / length)) : 0;
  return Math.hypot(x + dx * t, z + dz * t);
}
/**
 * A move conflicts if it gets too close AND closer than now (or a body grows, e.g. lifting
 * a pallet): moving apart is always allowed, so touching vehicles can still separate.
 */
function conflicts(
  a: Vector3,
  b: Vector3,
  c: Vector3,
  d: Vector3,
  limit: number,
  grows = false,
) {
  const distance = separation(a, b, c, d);
  if (distance >= limit - 1e-8) return false;
  if (grows) return true;
  const now = Math.hypot(a.x - c.x, a.z - c.z),
    end = Math.hypot(b.x - d.x, b.z - d.z);
  // Inside the limit only a move that actually opens the gap is allowed: closing in, dipping
  // closer on the way, or sliding alongside at the same distance (bodies passing through) conflict.
  return distance < now - 1e-7 || end <= now + 1e-6;
}
/** A body the traffic controller must keep clear of but does not drive (e.g. a forklift). */
export type TrafficBody = { position: Vector3; radius: number };
const grows = (vehicle: Vehicle, next: Vector3) =>
  vehicle.dispatch.radiusAt(next) > vehicle.dispatch.radius + 1e-9;
function polylineDistance(point: Vector3, path: readonly Vector3[]) {
  let distance = Infinity;
  for (let i = 0; i < path.length; i++) {
    const a = path[i],
      b = path[Math.min(i + 1, path.length - 1)],
      dx = b.x - a.x,
      dz = b.z - a.z,
      length = dx * dx + dz * dz;
    const t = length
      ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length))
      : 0;
    distance = Math.min(
      distance,
      Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz),
    );
  }
  return distance;
}
/** Points every ~0.1 m along `path`, up to `limit` metres. */
function samples(path: readonly Vector3[], limit = Infinity) {
  const out: Vector3[] = path.length ? [path[0]] : [];
  let travelled = 0;
  for (let i = 1; i < path.length && travelled < limit; i++) {
    const a = path[i - 1],
      b = path[i],
      length = a.distanceTo(b),
      steps = Math.max(1, Math.ceil(length / 0.1));
    for (let n = 1; n <= steps && travelled + (length * n) / steps <= limit; n++)
      out.push(a.clone().lerp(b, n / steps));
    travelled += length;
  }
  return out;
}

/**
 * Paths may overlap. Only nearby predicted body conflicts stop a vehicle.
 * A vehicle that waits too long first replans around the others; if the pair is
 * still stuck (head-on, occupied goal), the lower-priority vehicle steps aside to a
 * cell clear of the winner's next stretch of route and resumes once it has passed.
 */
export class AMRTrafficController {
  private motions = new Map<string, Motion>();
  private margin = AMR_TRAFFIC.safetyMargin;
  /** True when `other` sits on `vehicle`'s goal. */
  private occupiesGoal(vehicle: Vehicle, other: Vehicle) {
    const goal = vehicle.dispatch.goal,
      position = other.dispatch.carrier.position;
    return (
      !!goal &&
      Math.hypot(goal.x - position.x, goal.z - position.z) <
        vehicle.dispatch.radiusAt(goal) + other.dispatch.radius + this.margin
    );
  }
  /**
   * Negative when `a` has right of way. A vehicle whose goal the other occupies waits;
   * then a returning vehicle clears the shared dock first; then the one closer to its goal
   * finishes first (it frees the space soonest); stable ids break remaining ties.
   */
  priority(a: Vehicle, b: Vehicle) {
    const blockedA = this.occupiesGoal(a, b),
      blockedB = this.occupiesGoal(b, a);
    if (blockedA !== blockedB) return blockedA ? 1 : -1;
    const returning =
      Number(b.dispatch.phase === "returning") -
      Number(a.dispatch.phase === "returning");
    if (returning) return returning;
    const remaining = a.dispatch.remainingLength() - b.dispatch.remainingLength();
    if (Math.abs(remaining) > 0.5) return remaining;
    return a.id.localeCompare(b.id);
  }
  advance(vehicles: Vehicle[], delta: number, replan: TrafficPlanner, bodies: readonly TrafficBody[] = []) {
    const steps = Math.max(1, Math.ceil(delta / (1 / 30))),
      dt = delta / steps;
    for (const vehicle of vehicles)
      if (!this.motions.has(vehicle.id))
        this.motions.set(vehicle.id, {
          next: new Vector3(),
          ahead: new Vector3(),
          allowed: false,
          wait: 0,
          retry: 0,
          yieldFrom: null,
          hold: 0,
        });
    for (let step = 0; step < steps; step++) {
      for (const vehicle of vehicles) {
        const motion = this.motions.get(vehicle.id)!;
        motion.allowed = vehicle.enabled;
        motion.retry -= dt;
        if (!vehicle.dispatch.moving) {
          motion.yieldFrom = null;
          motion.hold = 0;
        }
        vehicle.dispatch.predict(
          vehicle.enabled ? dt * vehicle.speed : 0,
          motion.next,
        );
        vehicle.dispatch.predict(
          vehicle.enabled ? 0.8 * vehicle.speed : 0,
          motion.ahead,
        );
        vehicle.dispatch.yielding = false;
      }
      const priority = (a: Vehicle, b: Vehicle) => this.priority(a, b);
      for (let i = 0; i < vehicles.length; i++)
        for (let j = i + 1; j < vehicles.length; j++) {
          const a = vehicles[i],
            b = vehicles[j],
            ma = this.motions.get(a.id)!,
            mb = this.motions.get(b.id)!;
          if (!a.dispatch.moving || !b.dispatch.moving) continue;
          if (
            conflicts(
              a.dispatch.carrier.position,
              ma.ahead,
              b.dispatch.carrier.position,
              mb.ahead,
              a.dispatch.radius + b.dispatch.radius + this.margin,
            )
          ) {
            (priority(a, b) <= 0 ? mb : ma).allowed = false;
          }
        }
      // Bodies outside this controller (forklifts) never yield here: stop short of them.
      for (const vehicle of vehicles) {
        const motion = this.motions.get(vehicle.id)!,
          position = vehicle.dispatch.carrier.position;
        if (!motion.allowed || !vehicle.dispatch.moving) continue;
        for (const body of bodies)
          if (
            conflicts(position, motion.ahead, body.position, body.position, vehicle.dispatch.radius + body.radius + this.margin) ||
            conflicts(position, motion.next, body.position, body.position, vehicle.dispatch.radiusAt(motion.next) + body.radius + this.margin, grows(vehicle, motion.next))
          ) {
            motion.allowed = false;
            break;
          }
      }
      // Recheck after every stop: the winner must also clear the stopped vehicle's actual body.
      for (let pass = 0; pass < vehicles.length; pass++) {
        let changed = false;
        for (let i = 0; i < vehicles.length; i++)
          for (let j = i + 1; j < vehicles.length; j++) {
            const a = vehicles[i],
              b = vehicles[j],
              ma = this.motions.get(a.id)!,
              mb = this.motions.get(b.id)!;
            const pa = a.dispatch.carrier.position,
              pb = b.dispatch.carrier.position;
            const na = ma.allowed ? ma.next : pa,
              nb = mb.allowed ? mb.next : pb;
            if (
              !conflicts(
                pa,
                na,
                pb,
                nb,
                a.dispatch.radiusAt(na) + b.dispatch.radiusAt(nb) + this.margin,
                grows(a, na) || grows(b, nb),
              )
            )
              continue;
            const movingA = ma.allowed && a.dispatch.moving,
              movingB = mb.allowed && b.dispatch.moving;
            const loser =
              movingA && movingB
                ? priority(a, b) <= 0
                  ? mb
                  : ma
                : movingA
                  ? ma
                  : movingB
                    ? mb
                    : null;
            if (loser) {
              loser.allowed = false;
              changed = true;
            }
          }
        if (!changed) break;
      }
      // If the preferred vehicle is itself blocked, let a safe escape/detour move first.
      // Otherwise a slower yielding vehicle can be prevented from clearing the winner's way.
      for (const vehicle of vehicles) {
        const motion = this.motions.get(vehicle.id)!,
          dispatch = vehicle.dispatch;
        if (motion.allowed || !vehicle.enabled || !dispatch.moving) continue;
        const blockedPeer = vehicles.some(
          (other) =>
            other !== vehicle &&
            other.enabled &&
            other.dispatch.moving &&
            !this.motions.get(other.id)!.allowed,
        );
        if (!blockedPeer) continue;
        const safe = vehicles.every((other) => {
          if (other === vehicle) return true;
          const peer = this.motions.get(other.id)!,
            position = other.dispatch.carrier.position,
            next = peer.allowed ? peer.next : position;
          return !conflicts(
            dispatch.carrier.position,
            motion.next,
            position,
            next,
            dispatch.radiusAt(motion.next) + other.dispatch.radiusAt(next) + this.margin,
            grows(vehicle, motion.next) || grows(other, next),
          );
        });
        if (
          safe &&
          bodies.every(
            (body) =>
              !conflicts(dispatch.carrier.position, motion.next, body.position, body.position, dispatch.radiusAt(motion.next) + body.radius + this.margin, grows(vehicle, motion.next)),
          )
        )
          motion.allowed = true;
      }
      for (const vehicle of vehicles) {
        const motion = this.motions.get(vehicle.id)!,
          dispatch = vehicle.dispatch;
        if (!vehicle.enabled) continue;
        if (dispatch.holding) {
          this.release(vehicle, motion, vehicles, replan, dt);
          continue;
        }
        if (motion.allowed) {
          dispatch.advance(dt * vehicle.speed * (dispatch.reversing ? TRAFFIC_RESOLUTION.reverseSpeed : 1));
          motion.wait = 0;
        } else if (dispatch.moving) {
          dispatch.yielding = true;
          motion.wait += dt;
          if (motion.wait < 0.8 || motion.retry > 0) continue;
          motion.retry = 1;
          // Timeout: look for a detour around the current bodies first.
          if (motion.wait < TRAFFIC_RESOLUTION.deadlock) {
            const path = replan(vehicle);
            if (path) dispatch.reroute(path);
            continue;
          }
          // Still stuck: a deadlock. The lower-priority vehicle of the pair steps aside.
          this.resolve(vehicle, vehicles, replan, bodies);
        }
      }
    }
  }
  /** Nearest other vehicle whose body keeps `vehicle` from moving. */
  private blocker(vehicle: Vehicle, vehicles: Vehicle[]) {
    const position = vehicle.dispatch.carrier.position,
      motion = this.motions.get(vehicle.id)!;
    let best: Vehicle | null = null,
      distance = Infinity;
    for (const other of vehicles) {
      if (other === vehicle) continue;
      const peer = other.dispatch.carrier.position,
        range =
          vehicle.dispatch.radius + other.dispatch.radius + this.margin + 0.8 * vehicle.speed;
      const gap = Math.min(position.distanceTo(peer), motion.ahead.distanceTo(peer));
      if (gap < range && gap < distance) {
        best = other;
        distance = gap;
      }
    }
    return best;
  }
  /** Nearest forklift body stopping `vehicle`. */
  private blockingBody(vehicle: Vehicle, bodies: readonly TrafficBody[]) {
    const position = vehicle.dispatch.carrier.position,
      ahead = this.motions.get(vehicle.id)!.ahead;
    let best: TrafficBody | null = null,
      distance = Infinity;
    for (const body of bodies) {
      const gap = Math.min(position.distanceTo(body.position), ahead.distanceTo(body.position)),
        range = vehicle.dispatch.radius + body.radius + this.margin + 0.8 * vehicle.speed;
      if (gap < range && gap < distance) {
        best = body;
        distance = gap;
      }
    }
    return best;
  }
  private resolve(vehicle: Vehicle, vehicles: Vehicle[], replan: TrafficPlanner, bodies: readonly TrafficBody[]) {
    const other = this.blocker(vehicle, vehicles);
    if (!other) {
      // A forklift never yields to regular AMRs here, so the regular AMR backs off / steps aside for it.
      const body = this.blockingBody(vehicle, bodies);
      if (body) {
        // Its route is unknown here: assume it drives on through this vehicle, so step off that line.
        const through = vehicle.dispatch.carrier.position.clone().sub(body.position).setY(0);
        const corridor = [body.position.clone()];
        if (through.lengthSq() > 1e-8)
          corridor.push(body.position.clone().addScaledVector(through.normalize(), TRAFFIC_RESOLUTION.corridor));
        const peer = { id: BODY_YIELD, position: body.position, radius: body.radius, corridor };
        if (this.stepAside(vehicle, peer, vehicles, replan, bodies) || this.backOff(vehicle, peer, vehicles, replan, bodies)) return;
      }
      const path = replan(vehicle);
      if (path) vehicle.dispatch.reroute(path);
      return;
    }
    const otherMoves = other.enabled && other.dispatch.moving;
    // A parked/loading/unloading peer cannot move: detour around it, else back off so a detour opens up.
    if (!otherMoves) {
      const path = replan(vehicle);
      if (path) vehicle.dispatch.reroute(path);
      else this.backOff(vehicle, this.peer(other), vehicles, replan, bodies);
      return;
    }
    const [loser, winner] =
      this.priority(vehicle, other) <= 0 ? [other, vehicle] : [vehicle, other];
    if (this.motions.get(loser.id)!.yieldFrom === winner.id && loser.dispatch.holding) return;
    // Deterministic order: the lower-priority vehicle yields (side cell, else straight reverse); only if it
    // cannot move at all does the winner try the same.
    if (this.stepAside(loser, this.peer(winner), vehicles, replan, bodies)) return;
    if (this.backOff(loser, this.peer(winner), vehicles, replan, bodies)) return;
    if (this.stepAside(winner, this.peer(loser), vehicles, replan, bodies)) return;
    this.backOff(winner, this.peer(loser), vehicles, replan, bodies);
  }
  private peer(vehicle: Vehicle): Peer {
    return {
      id: vehicle.id,
      position: vehicle.dispatch.carrier.position,
      radius: vehicle.dispatch.radius,
      corridor: vehicle.dispatch.moving
        ? vehicle.dispatch.remaining(TRAFFIC_RESOLUTION.corridor)
        : [vehicle.dispatch.carrier.position.clone()],
    };
  }
  /** True when `point` keeps clear of every other AMR body and forklift body (except the peer). */
  private clearOfOthers(point: Vector3, loser: Vehicle, peer: Peer, vehicles: Vehicle[], bodies: readonly TrafficBody[]) {
    const radius = loser.dispatch.radius;
    return (
      vehicles.every(
        (other) =>
          other === loser ||
          other.id === peer.id ||
          point.distanceTo(other.dispatch.carrier.position) >=
            radius + other.dispatch.radius + this.margin + 0.05,
      ) &&
      bodies.every(
        (body) =>
          body.position === peer.position ||
          point.distanceTo(body.position) >= radius + body.radius + this.margin + 0.05,
      )
    );
  }
  private commitYield(loser: Vehicle, peer: Peer, path: Vector3[], reverse: boolean) {
    if (reverse) loser.dispatch.reverse(path);
    else loser.dispatch.reroute(path);
    const motion = this.motions.get(loser.id)!;
    motion.yieldFrom = peer.id;
    motion.hold = 0;
    motion.wait = 0;
  }
  /** Moves `loser` to a nearby cell clear of the peer's next stretch of route. */
  private stepAside(
    loser: Vehicle,
    peer: Peer,
    vehicles: Vehicle[],
    replan: TrafficPlanner,
    bodies: readonly TrafficBody[],
  ) {
    if (!loser.enabled || !loser.dispatch.moving) return false;
    const config = TRAFFIC_RESOLUTION,
      position = loser.dispatch.carrier.position,
      need = loser.dispatch.radius + peer.radius + this.margin;
    const candidates: { point: Vector3; score: number }[] = [];
    for (const ring of config.rings)
      for (let k = 0; k < config.angles; k++) {
        const angle = (k / config.angles) * Math.PI * 2,
          point = new Vector3(
            position.x + ring * Math.cos(angle),
            0,
            position.z + ring * Math.sin(angle),
          );
        if (polylineDistance(point, peer.corridor) < need + 0.05) continue;
        if (!this.clearOfOthers(point, loser, peer, vehicles, bodies)) continue;
        // Prefer short moves that head away from the peer.
        candidates.push({ point, score: ring - 0.5 * (point.distanceTo(peer.position) - position.distanceTo(peer.position)) });
      }
    candidates.sort((a, b) => a.score - b.score);
    const floor = Math.min(position.distanceTo(peer.position), need) - 1e-6;
    for (const { point } of candidates.slice(0, config.attempts)) {
      const path = replan(loser, point);
      if (!path) continue;
      // The side step itself must never close in on the peer.
      if (samples(path).some((sample) => sample.distanceTo(peer.position) < floor)) continue;
      this.commitYield(loser, peer, path, this.backward(loser, path));
      return true;
    }
    return false;
  }
  /** True when the path's first leg points behind the vehicle (drive it in reverse). */
  private backward(vehicle: Vehicle, path: readonly Vector3[]) {
    const position = vehicle.dispatch.carrier.position,
      yaw = vehicle.dispatch.carrier.rotation.y;
    for (const point of path) {
      const dx = point.x - position.x,
        dz = point.z - position.z,
        length = Math.hypot(dx, dz);
      if (length < 0.05) continue;
      return -(Math.sin(yaw) * dx + Math.cos(yaw) * dz) / length > 0.5;
    }
    return false;
  }
  /**
   * Fallback when no side cell is reachable: back straight away from the peer (heading kept) so it
   * gets room to detour. Validated by the planner (navigation grid, walls, other bodies).
   */
  private backOff(
    loser: Vehicle,
    peer: Peer,
    vehicles: Vehicle[],
    replan: TrafficPlanner,
    bodies: readonly TrafficBody[],
  ) {
    if (!loser.enabled || !loser.dispatch.moving) return false;
    const position = loser.dispatch.carrier.position,
      yaw = loser.dispatch.carrier.rotation.y;
    let dx = position.x - peer.position.x,
      dz = position.z - peer.position.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return false;
    dx /= length;
    dz /= length;
    // Straight back along the heading when the peer is in front; otherwise directly away from it.
    const fx = Math.sin(yaw),
      fz = Math.cos(yaw);
    if (-(fx * dx + fz * dz) > 0.7) {
      dx = -fx;
      dz = -fz;
    }
    for (const distance of TRAFFIC_RESOLUTION.reverse) {
      const point = new Vector3(position.x + dx * distance, 0, position.z + dz * distance);
      if (!this.clearOfOthers(point, loser, peer, vehicles, bodies)) continue;
      const path = replan(loser, point);
      // Only a (nearly) straight move: a long detour is not a back-off.
      if (!path || pathLength(path) > distance * 1.5 + 0.2) continue;
      this.commitYield(loser, peer, path, this.backward(loser, path));
      return true;
    }
    return false;
  }
  /** A vehicle parked at its side cell resumes once the winner's route no longer needs the space. */
  private release(
    vehicle: Vehicle,
    motion: Motion,
    vehicles: Vehicle[],
    replan: TrafficPlanner,
    dt: number,
  ) {
    const dispatch = vehicle.dispatch;
    dispatch.yielding = true;
    motion.hold += dt;
    if (motion.retry > 0) return;
    motion.retry = 0.5;
    // Yielded to a forklift (no known route): give it a moment to pass first.
    if (motion.yieldFrom === BODY_YIELD && motion.hold < TRAFFIC_RESOLUTION.bodyHold) return;
    const winner = vehicles.find((other) => other.id === motion.yieldFrom);
    const path = replan(vehicle);
    if (!path) return;
    const passed =
      !winner ||
      !winner.enabled ||
      !winner.dispatch.moving ||
      motion.hold > TRAFFIC_RESOLUTION.maxHold ||
      samples(path, 3).every(
        (point) =>
          polylineDistance(point, winner.dispatch.remaining(TRAFFIC_RESOLUTION.corridor)) >=
          dispatch.radius + winner.dispatch.radius + this.margin,
      );
    if (!passed) return;
    dispatch.reroute(path);
    motion.yieldFrom = null;
    motion.hold = 0;
    motion.wait = 0;
  }
}
type Peer = { id: string; position: Vector3; radius: number; corridor: Vector3[] };
const BODY_YIELD = "\u0000rack-body";
function pathLength(path: readonly Vector3[]) {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += path[i - 1].distanceTo(path[i]);
  return length;
}
