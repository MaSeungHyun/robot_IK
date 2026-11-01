import Button from "@/components/Button";
import Icon from "@/components/Icon";
import AMRStatusBadge from "@/ui/Hud/equipment/amr/AMRStatusBadge";
import AMRLivePose from "@/ui/Hud/equipment/amr/AMRLivePose";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import { useSceneStore } from "@/stores/useSceneStore";
import { useHudStore } from "@/stores/useHudStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useCameraTrackingStore } from "@/stores/useCameraTrackingStore";

/** Play-mode details for an outbound AMR. It is spawned by the pallet cycle, not stored as scene equipment. */
export default function ShipAmrDetails({ id }: { id: string }) {
  const item = useSimulationStore((state) => state.equipment?.cycle?.find((entry) => entry.id === id));
  const agent = useSimulationStore((state) => state.equipment?.agents.find((entry) => entry.id === id));
  const inspect = useSceneStore((state) => state.inspect);
  const selectTab = useHudStore((state) => state.selectInspectorTab);
  const tracking = useCameraTrackingStore((state) => state.trackedId === id);
  const toggleTracking = useCameraTrackingStore((state) => state.toggle);
  const name = agent?.name ?? "출하 AMR";

  return (
    <div className="min-w-0 pb-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Button
          type="button"
          onClick={() => {
            inspect(null);
            selectTab("equipments");
          }}
          aria-label="장비 현황으로 돌아가기"
          className="h-6 w-fit rounded-[3px] px-2 text-[11px]"
        >
          <Icon icon="ArrowLeft" size={12} />
        </Button>
        <Button
          type="button"
          active={tracking}
          aria-pressed={tracking}
          aria-label={tracking ? "카메라 추적 해제" : "카메라로 추적"}
          title={tracking ? "카메라 추적 해제" : "카메라로 추적 (회전·줌 유지, 이동하면 해제)"}
          onClick={() => toggleTracking(id)}
          className="h-6 w-fit gap-1 rounded-[3px] px-2 text-[11px]"
        >
          <Icon icon="LocateFixed" size={12} className="size-3" />
          {tracking ? "추적 중" : "추적"}
        </Button>
      </div>

      <header className="min-w-0">
        <h2 className="truncate text-xs font-semibold text-text-primary" title={name}>
          {name} <span className="text-text-secondary">· 출하 AMR</span>
        </h2>
        <div className="mt-2">
          <DetailRows rows={[
            { label: "상태", value: agent ? <AMRStatusBadge state={agent.state} /> : "준비 중" },
            { label: "역할", value: "출하 컨베이어로 팔레트를 밀어 넣음" },
          ]} />
        </div>
      </header>

      <DetailSection title="팔레트 사이클">
        <DetailRows rows={[
          { label: "사이클 상태", value: item?.label ?? "대기 (플레이 시 갱신)" },
          { label: "상세", value: item?.detail ?? "-" },
          { label: "대상 컨베이어", value: agent?.target ?? undefined },
          { label: "출하 횟수", value: agent ? `${agent.completed}회` : undefined },
        ]} />
      </DetailSection>
      <DetailSection title="실시간 지표">
        <DetailRows rows={[
          { label: "현재 위치", value: <AMRLivePose id={id} field="position" /> },
          { label: "진행 방향", value: <AMRLivePose id={id} field="heading" /> },
          { label: "현재 속도", value: <AMRLivePose id={id} field="speed" /> },
        ]} />
      </DetailSection>
    </div>
  );
}
