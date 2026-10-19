import PalletStatusBadge from "@/features/Hud/equipment/pallet/PalletStatusBadge";
import EquipmentCard from "@/features/Hud/equipment/_components/EquipmentCard";
import type { EquipmentSnapshot } from "@/types/simulation";

type Props = { pallet: EquipmentSnapshot["pallets"][number] };

export default function PalletCard({ pallet }: Props) {
  return (
    <EquipmentCard id={pallet.id} name={pallet.name} className="flex justify-between px-2 py-2 text-[11px]">
      <span className="text-slate-400">{pallet.name}</span>
      <span className="flex items-center gap-2">
        <span className="tabular-nums text-text-secondary">{pallet.count} / {pallet.capacity}</span>
        <PalletStatusBadge shipping={pallet.shipping} count={pallet.count} capacity={pallet.capacity} />
      </span>
    </EquipmentCard>
  );
}
