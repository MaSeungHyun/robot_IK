import { Box3, Group, Vector3 } from "three";
import { BOX_BASE_SIZE, PALLET_BASE_SIZE } from "@/constants/simulation";

// Normalize once. The wrapper origin is the top-face centre (GripPoint).
export function createUnitBox(asset: Group) {
  const model = asset.clone(true);
  const native = new Box3().setFromObject(model).getSize(new Vector3());
  if(native.toArray().some(value=>!Number.isFinite(value)||value<=0))throw Error("Invalid box model bounds");
  model.scale.multiply(new Vector3(BOX_BASE_SIZE.x/native.x, BOX_BASE_SIZE.y/native.y, BOX_BASE_SIZE.z/native.z));
  const bounds = new Box3().setFromObject(model);
  const center = bounds.getCenter(new Vector3());
  model.position.sub(new Vector3(center.x, bounds.max.y, center.z));
  const unit = new Group();
  unit.add(model);
  unit.updateWorldMatrix(true,true);
  return unit;
}

// Unit pallet origin is its bottom-face centre. Apply final size only
// on the wrapper so exported scales never affect packing coordinates.
export function createUnitPallet(asset: Group) {
  const model=asset.clone(true);
  const native=new Box3().setFromObject(model).getSize(new Vector3());
  if(native.toArray().some(value=>!Number.isFinite(value)||value<=0))throw Error("Invalid pallet model bounds");
  model.scale.multiply(new Vector3(PALLET_BASE_SIZE.x/native.x,PALLET_BASE_SIZE.y/native.y,PALLET_BASE_SIZE.z/native.z));
  const bounds=new Box3().setFromObject(model),center=bounds.getCenter(new Vector3());
  model.position.sub(new Vector3(center.x,bounds.min.y,center.z));
  const unit=new Group();unit.add(model);unit.updateWorldMatrix(true,true);
  return unit;
}
