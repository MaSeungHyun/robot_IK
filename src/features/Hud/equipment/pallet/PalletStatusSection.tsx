import PalletCard from "@/features/Hud/equipment/pallet/PalletCard";
import { Package } from "lucide-react";
import type { EquipmentSnapshot } from "@/types/simulation";

type Props = {
  pallets: EquipmentSnapshot["pallets"];
};

export default function PalletStatusSection({ pallets }: Props) {
  return (
    <section aria-label="팔레트 적재 상태" className="mt-4">
      <h3 className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
        <Package size={14} />
        팔레트 · {pallets.length}개
      </h3>
      {pallets.map((pallet) => (
        <PalletCard key={pallet.id} pallet={pallet} />
      ))}
    </section>
  );
}
