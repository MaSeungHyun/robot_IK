import { Group, Vector3 } from "three";
import type { SceneEquipment } from "@/types/layout";
import { BOX_SIZES, STREAM_CONFIG } from "@/constants/simulation";
import { planStack } from "@/domain/pallet/packing/stacking";
import { createPalletModel } from "@/lib/three/palletModel";

const Y = new Vector3(0, 1, 0);
/** Depth (m) within which slots count as one row for far-first ordering. */
const ROW_TOLERANCE = 0.02;

/** Pallet-local behavior; robot assignment and AMR traffic stay with the factory. */
export class PalletController {
  readonly object: SceneEquipment;
  readonly slots: Vector3[];
  readonly states: ("free" | "reserved" | "placed")[];
  group: Group;
  count = 0;
  shipping = false;
  readyAt: number | null = null;
  private asset: Group;

  constructor(object: SceneEquipment, asset: Group, capacity: number) {
    this.object = object;
    this.asset = asset;
    this.slots = planStack(capacity, new Vector3(STREAM_CONFIG.palletWidth, STREAM_CONFIG.palletHeight, STREAM_CONFIG.palletDepth), BOX_SIZES[0], 0).slots.map(slot => slot.position.clone()
      .add(new Vector3(0, STREAM_CONFIG.palletHeight + BOX_SIZES[0].y, 0))
      .applyAxisAngle(Y, object.yaw).add(new Vector3(object.x, 0, object.z)));
    this.states = this.slots.map(() => "free");
    this.group = this.createGroup();
  }

  /**
   * Reorders the (still empty) slots for the robot at (x, z): layer by layer bottom-up and,
   * within a layer, the row farthest from the robot first, sweeping across each row, so a
   * placed box never sits between the robot and a later slot. Positions are untouched.
   */
  orderFrom(x: number, z: number) {
    if (this.count || this.states.some(state => state !== "free")) return;
    const dx = this.object.x - x, dz = this.object.z - z, length = Math.hypot(dx, dz);
    // Robot on the pallet centre: keep the packer's own order.
    if (length < 1e-6) return;
    const ax = dx / length, az = dz / length;
    const depth = (slot: Vector3) => (slot.x - x) * ax + (slot.z - z) * az;
    const side = (slot: Vector3) => (slot.z - z) * ax - (slot.x - x) * az;
    const layers = new Map<number, Vector3[]>();
    for (const slot of this.slots) {
      const key = Math.round(slot.y * 1000);
      layers.set(key, [...(layers.get(key) ?? []), slot]);
    }
    const ordered = [...layers.keys()].sort((a, b) => a - b).flatMap(key => {
      const layer = layers.get(key)!.sort((a, b) => depth(b) - depth(a));
      const rows: Vector3[][] = [];
      // Slots within ROW_TOLERANCE of the row's first (farthest) slot share a row.
      for (const slot of layer) {
        const row = rows.at(-1);
        if (row && depth(row[0]) - depth(slot) < ROW_TOLERANCE) row.push(slot);
        else rows.push([slot]);
      }
      return rows.flatMap(row => row.sort((a, b) => side(a) - side(b)));
    });
    this.slots.splice(0, this.slots.length, ...ordered);
  }

  get full() { return this.count === this.slots.length; }
  get availableSlot() { return this.shipping ? -1 : this.states.indexOf("free"); }

  reserve(slot: number) {
    if (this.shipping || this.states[slot] !== "free") return false;
    this.states[slot] = "reserved";
    return true;
  }

  place(slot: number, box: Group, elapsed: number) {
    if (this.states[slot] !== "reserved" || this.shipping) throw new Error("Pallet slot is not reserved");
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

  private createGroup() {
    const group = new Group();
    group.add(createPalletModel(this.asset));
    group.position.set(this.object.x, 0, this.object.z);
    group.rotation.y = this.object.yaw;
    group.userData.sceneId = this.object.id;
    return group;
  }
}
