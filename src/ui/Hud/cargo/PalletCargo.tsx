import { useCargoStore } from "@/stores/useCargoStore";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";

/** Pallet id and loaded box list of the pallet currently loading on this station (play mode). */
export default function PalletCargo({ stationId }: { stationId: string }) {
  useCargoStore((state) => state.version);
  const registry = useCargoStore((state) => state.registry);
  const selectBox = useCargoStore((state) => state.selectBox);
  const pallet = registry?.currentPallet(stationId);
  if (!registry) return null;
  return (
    <DetailSection title={pallet ? `팔레트 ${pallet.id} · 적재 박스 ${pallet.boxIds.length}개` : "팔레트 교체 중"}>
      {pallet && pallet.boxIds.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {pallet.boxIds.map((id) => (
            <button
              key={id}
              type="button"
              className={`rounded px-1.5 py-0.5 tabular-nums hover:bg-white/10 ${registry.box(id)?.inspection === "defect" ? "text-red-300" : ""}`}
              onClick={() => selectBox(id)}
            >
              {id}
            </button>
          ))}
        </div>
      ) : (
        <p>적재된 박스가 없습니다.</p>
      )}
    </DetailSection>
  );
}
