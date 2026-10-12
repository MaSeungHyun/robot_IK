import { Vector3 } from "three";

export type StackSlot = { position: Vector3; layer: number };

// Compare both 90-degree orientations of identical boxes. This is optimal
// among uniform rectangular grids; mixed orientations are not searched.
export function planStack(count: number, pallet: Vector3, box: Vector3, gap = 0.025) {
  const options = [false, true].map(rotated => {
    const width = rotated ? box.z : box.x;
    const depth = rotated ? box.x : box.z;
    const columns = Math.floor((pallet.x + gap) / (width + gap));
    const rows = Math.floor((pallet.z + gap) / (depth + gap));
    return { rotated, width, depth, columns, rows, capacity: columns * rows };
  }).sort((a, b) => b.capacity - a.capacity);
  const layout = options[0];
  if (!layout.capacity) throw new Error("Box does not fit on pallet");
  const cells = Array.from({ length: layout.capacity }, (_, i) => new Vector3(
    (i % layout.columns - (layout.columns - 1) / 2) * (layout.width + gap),
    0,
    (Math.floor(i / layout.columns) - (layout.rows - 1) / 2) * (layout.depth + gap),
  )).sort((a, b) => a.lengthSq() - b.lengthSq());
  const slots: StackSlot[] = Array.from({ length: count }, (_, i) => {
    const layer = Math.floor(i / layout.capacity);
    return { position: cells[i % layout.capacity].clone().setY(layer * box.y), layer };
  });
  return { ...layout, slots };
}
