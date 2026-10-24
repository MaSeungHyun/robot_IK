import { Box3, Group, Vector3 } from "three";

// Recentre only (authored scale). The wrapper origin is the top-face centre (GripPoint).
export function createUnitBox(asset: Group) {
  const model = asset.clone(true);
  const native = new Box3().setFromObject(model).getSize(new Vector3());
  if(native.toArray().some(value=>!Number.isFinite(value)||value<=0))throw Error("Invalid box model bounds");
  const bounds = new Box3().setFromObject(model);
  const center = bounds.getCenter(new Vector3());
  model.position.sub(new Vector3(center.x, bounds.max.y, center.z));
  const unit = new Group();
  unit.add(model);
  unit.updateWorldMatrix(true,true);
  return unit;
}

// Recentre only (authored scale). Pallet origin is its bottom-face centre.
export function createUnitPallet(asset: Group) {
  const model=asset.clone(true);
  const native=new Box3().setFromObject(model).getSize(new Vector3());
  if(native.toArray().some(value=>!Number.isFinite(value)||value<=0))throw Error("Invalid pallet model bounds");
  const bounds=new Box3().setFromObject(model),center=bounds.getCenter(new Vector3());
  model.position.sub(new Vector3(center.x,bounds.min.y,center.z));
  const unit=new Group();unit.add(model);unit.updateWorldMatrix(true,true);
  return unit;
}
