import { Group, Vector3 } from "three";
import type { SceneEquipment } from "@/types/layout";
import { BOX_SIZES, PALLET_STACKING, STREAM_CONFIG } from "@/constants/simulation";
import { planStack } from "@/domain/pallet/packing/stacking";
import { createPalletModel } from "@/lib/three/palletModel";

const Y = new Vector3(0, 1, 0);
/** Distance (m) within which slots count as equally far (deterministic tie-break by position). */
const DISTANCE_TOLERANCE = 1e-6;

/** Pallet-local behavior; robot assignment and AMR traffic stay with the factory. */
export class PalletController {
  readonly object: SceneEquipment;
  readonly slots: Vector3[];
  readonly states: ("free" | "reserved" | "placed")[];
  group: Group;
  count = 0;
  shipping = false;
  readyAt: number | null = null;
  /** Driven by an owner other than the factory dispatch round (pallet cycle shuttle). */
  managed = false;
  /** Pallet bottom height (0 = floor, AMR_DECK when mounted on a shuttle AMR). */
  readonly baseY: number;
  private asset: Group;

  /** Slots per layer and layer count actually used (capacity is capped to PALLET_STACKING.layers full layers). */
  readonly perLayer: number;
  readonly layers: number;

  constructor(object: SceneEquipment, asset: Group, capacity: number, baseY = 0) {
    this.object = object;
    this.baseY = baseY;
    this.asset = asset;
    const palletSize = new Vector3(STREAM_CONFIG.palletWidth, STREAM_CONFIG.palletHeight, STREAM_CONFIG.palletDepth);
    this.perLayer = planStack(1, palletSize, BOX_SIZES[0], 0).capacity;
    const total = Math.max(1, Math.min(capacity, this.perLayer * PALLET_STACKING.layers));
    this.layers = Math.ceil(total / this.perLayer);
    // Slot y = pallet top + (layer + 1) * box height: the top face of the box (suction contact).
    this.slots = planStack(total, new Vector3(STREAM_CONFIG.palletWidth, STREAM_CONFIG.palletHeight, STREAM_CONFIG.palletDepth), BOX_SIZES[0], 0).slots.map(slot => slot.position.clone()
      .add(new Vector3(0, baseY + STREAM_CONFIG.palletHeight + BOX_SIZES[0].y, 0))
      .applyAxisAngle(Y, object.yaw).add(new Vector3(object.x, 0, object.z)));
    this.states = this.slots.map(() => "free");
    this.group = this.createGroup();
  }

  /**
   * Reorders the (still empty) slots for the loading robot(s): layer by layer bottom-up and, within a
   * layer, by horizontal distance to the nearest loader descending (farthest first), so the arm never
   * reaches over a box already placed in the current layer. Several loaders sharing a pallet each fill
   * from their far side towards the boundary between them. Slots no loader can reach (horizontal
   * distance > its reach) are dropped so the pallet can still complete. Positions are untouched.
   */
  orderFrom(loaders: readonly { x: number; z: number; reach: number }[]) {
    if (!loaders.length || this.count || this.states.some(state => state !== "free")) return;
    const near = (slot: Vector3) => Math.min(...loaders.map(l => Math.hypot(slot.x - l.x, slot.z - l.z)));
    const reachable = this.slots.filter(slot => loaders.some(l => Math.hypot(slot.x - l.x, slot.z - l.z) <= l.reach));
    if (!reachable.length) return;
    const ordered = reachable.sort((a, b) => {
      const layer = Math.round(a.y * 1000) - Math.round(b.y * 1000);
      if (layer) return layer;
      const far = near(b) - near(a);
      if (Math.abs(far) > DISTANCE_TOLERANCE) return far;
      return a.x - b.x || a.z - b.z;
    });
    this.slots.splice(0, this.slots.length, ...ordered);
    this.states.length = this.slots.length;
  }

  /** Layer index (0 = bottom) of slot `slot`. */
  layerOf(slot: number) {
    return Math.round((this.slots[slot].y - this.baseY - STREAM_CONFIG.palletHeight) / BOX_SIZES[0].y) - 1;
  }

  /** Top face (world y) of the tallest box on the pallet, or the pallet top when empty. */
  get stackTop() {
    let top = this.baseY + STREAM_CONFIG.palletHeight;
    this.states.forEach((state, i) => { if (state === "placed") top = Math.max(top, this.slots[i].y); });
    return top;
  }

  get full() { return this.count === this.slots.length; }
  get availableSlot() { return this.shipping ? -1 : this.states.indexOf("free"); }

  reserve(slot: number) {
    if (this.shipping || this.states[slot] !== "free") return false;
    this.states[slot] = "reserved";
    return true;
  }

  place(slot: number, box: Group, elapsed: number) {
    if (this.states[slot] !== "reserved" || this.shipping) throw new Error(`Pallet slot is not reserved (${this.object.id} slot ${slot}: ${this.states[slot]}${this.shipping ? ", shipping" : ""})`);
    this.group.attach(box);
    this.states[slot] = "placed";
    this.count++;
    if (this.full) this.readyAt = elapsed;
  }

  release(slot: number) {
    if (this.states[slot] === "reserved") this.states[slot] = "free";
  }

  beginShipment() {
    if (this.shipping || !this.full) return null;
    this.shipping = true;
    return this.group;
  }

  replace() {
    if (!this.shipping) return this.group;
    // The outgoing group remains attached to its AMR until delivery completes.
    this.group = this.createGroup();
    this.states.fill("free");
    this.count = 0;
    this.shipping = false;
    this.readyAt = null;
    return this.group;
  }

  /** A pallet that arrived already loaded (pallet-unit inbound): every slot counts as placed. */
  loadAll(elapsed: number) {
    this.states.fill("placed");
    this.count = this.slots.length;
    this.readyAt = elapsed;
  }

  /** Starts a new empty load on `group` (already placed at the station; pallet cycle). */
  mount(group: Group) {
    this.group = group;
    group.userData.sceneId = this.object.id;
    this.states.fill("free");
    this.count = 0;
    this.shipping = false;
    this.readyAt = null;
  }

  private createGroup() {
    const group = new Group();
    group.add(createPalletModel(this.asset));
    group.position.set(this.object.x, this.baseY, this.object.z);
    group.rotation.y = this.object.yaw;
    group.userData.sceneId = this.object.id;
    return group;
  }
}
