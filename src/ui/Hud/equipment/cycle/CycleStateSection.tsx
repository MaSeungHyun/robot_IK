import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useSceneStore } from "@/stores/useSceneStore";
import type { CycleSnapshot } from "@/types/simulation";

const CYCLE_ROLES: Record<CycleSnapshot["kind"], string> = {
  shuttle: "팔레트 셔틀 AMR",
  forklift: "사이클 지게차",
  agv: "랙 운반 AGV",
  rackm: "이동식 랙 (Rack_m)",
};

/** Pallet-cycle state row for shuttle / forklift / AGV / Rack_m; shown in Edit too (idle until a cycle run). */
export default function CycleStateSection({ id }: { id: string }) {
  const item = useSimulationStore((state) => state.equipment?.cycle?.find((entry) => entry.id === id));
  const configured = useSceneStore((state): CycleSnapshot["kind"] | undefined => {
    const settings = state.settings[id];
    const kind = state.objects.find((o) => o.id === id)?.kind;
    if (kind === "rack") return settings?.rackType === "mobile" ? "rackm" : undefined;
    if (kind !== "amr") return undefined;
    const role = settings?.amrRole;
    return role === "shuttle" || role === "forklift" || role === "agv" ? role : undefined;
  });
  if (!item) {
    if (!configured) return null;
    return (
      <DetailSection title="팔레트 사이클">
        <DetailRows rows={[
          { label: "역할", value: CYCLE_ROLES[configured] },
          { label: "사이클 상태", value: "대기 (플레이 시 갱신)" },
          { label: "상세", value: "-" },
        ]} />
      </DetailSection>
    );
  }
  return (
    <DetailSection title="팔레트 사이클">
      <DetailRows rows={[
        { label: "역할", value: CYCLE_ROLES[item.kind] },
        { label: "사이클 상태", value: item.label },
        { label: "상세", value: item.detail },
      ]} />
    </DetailSection>
  );
}
