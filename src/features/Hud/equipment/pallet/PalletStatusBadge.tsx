import Badge from "@/components/Badge";
import type { EquipmentSnapshot } from "@/types/simulation";

type Props = Pick<
  EquipmentSnapshot["pallets"][number],
  "shipping" | "count" | "capacity"
>;

export default function PalletStatusBadge({
  shipping,
  count,
  capacity,
}: Props) {
  if (shipping) return <Badge tone="operating">운반 중</Badge>;
  if (count >= capacity) return <Badge tone="info">적재 완료</Badge>;
  if (count > 0) return <Badge tone="operating">적재 중</Badge>;

  return <Badge tone="idle">대기</Badge>;
}
