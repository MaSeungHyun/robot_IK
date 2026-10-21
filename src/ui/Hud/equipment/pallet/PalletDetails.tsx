import { formatMetric } from "@/utils/equipment/formatMetric";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import Badge from "@/components/Badge";
import PalletStatusBadge from "@/ui/Hud/equipment/pallet/PalletStatusBadge";
import EquipmentDetailLayout from "@/ui/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import EquipmentNumberSetting from "@/ui/Hud/equipment/details/_components/EquipmentNumberSetting";
import EquipmentChoiceSetting from "@/ui/Hud/equipment/details/_components/EquipmentChoiceSetting";
import EquipmentEnabledSetting from "@/ui/Hud/equipment/details/_components/EquipmentEnabledSetting";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import { useSimulationStore } from "@/stores/useSimulationStore";

export default function PalletDetails({ object }: EquipmentDetailProps) {
  const pallet = useSimulationStore((state) =>
    state.equipment?.pallets.find((pallet) => pallet.id === object.id),
  );
  const fill =
    pallet && pallet.capacity > 0
      ? (pallet.count / pallet.capacity) * 100
      : undefined;

  const status = pallet ? (
    <PalletStatusBadge
      shipping={pallet.shipping}
      count={pallet.count}
      capacity={pallet.capacity}
    />
  ) : (
    <Badge tone="idle">준비 중</Badge>
  );

  return (
    <EquipmentDetailLayout
      object={object}
      status={status}
      summary={
        <DetailRows
          rows={[
            { label: "적재 수량", value: formatMetric(pallet?.count, "개", 0) },
            {
              label: "적재 용량",
              value: formatMetric(pallet?.capacity, "개", 0),
            },
            { label: "적재율", value: formatMetric(fill, "%"), progress: fill },
            {
              label: "운반 상태",
              value: pallet
                ? pallet.shipping
                  ? "운반 대기 · 교체 중"
                  : "적재 가능"
                : undefined,
            },
          ]}
        />
      }
      settings={
        <DetailSection title="팔레트 설정">
          <EquipmentNumberSetting
            id={object.id}
            field="capacity"
            label="적재 개수"
            min={1}
            step={1}
            integer
          />
          <p className="text-xs">변경하면 현재 적재가 초기화됩니다.</p>
          <EquipmentChoiceSetting
            id={object.id}
            field="grade"
            label="적재 등급"
            fallback="normal"
            options={[
              { value: "normal", label: "정상품" },
              { value: "defect", label: "불량품" },
            ]}
          />
          <EquipmentEnabledSetting id={object.id} />
        </DetailSection>
      }
    ></EquipmentDetailLayout>
  );
}
