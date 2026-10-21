import { Group, Vector3 } from "three";
import type { SceneEquipment } from "@/types/layout";
import { BOX_SIZES, STREAM_CONFIG } from "@/constants/simulation";
import { planStack } from "@/domain/pallet/packing/stacking";
import { createPalletModel } from "@/lib/three/palletModel";

const Y = new Vector3(0, 1, 0);

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
