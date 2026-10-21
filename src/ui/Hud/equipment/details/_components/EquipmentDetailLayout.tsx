import type { ReactNode } from "react";
import Button from "@/components/Button";
import EquipmentIdentity from "@/ui/Hud/equipment/details/EquipmentIdentity";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import { useSceneStore } from "@/stores/useSceneStore";
import { useModeStore } from "@/stores/useModeStore";
import { useHudStore } from "@/stores/useHudStore";
import Icon from "@/components/Icon";
import { useCameraTrackingStore } from "@/stores/useCameraTrackingStore";

type Props = EquipmentDetailProps & {
  status: ReactNode;
  summary: ReactNode;
  children?: ReactNode;
  settings?: ReactNode;
};

export default function EquipmentDetailLayout({
  object,
  status,
  summary,
  children,
  settings,
}: Props) {
  const inspect = useSceneStore((state) => state.inspect);
  const selectTab = useHudStore((state) => state.selectInspectorTab);
  const readOnly = useModeStore((state) => state.mode !== "simulation");
  const tracking = useCameraTrackingStore((state) => state.trackedId === object.id);
  const toggleTracking = useCameraTrackingStore((state) => state.toggle);

  return (
    <div className="min-w-0 pb-2">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          onClick={() => {
            inspect(null);
            selectTab("equipments");
          }}
          aria-label="장비 현황으로 돌아가기"
          className="h-7 w-fit px-2 text-xs"
        >
          <Icon icon="ArrowLeft" size={12} />
        </Button>
        <Button
          type="button"
          active={tracking}
          aria-pressed={tracking}
          aria-label={tracking ? "카메라 추적 해제" : "카메라로 추적"}
          title={tracking ? "카메라 추적 해제" : "카메라로 추적 (회전·줌 유지, 이동하면 해제)"}
          onClick={() => toggleTracking(object.id)}
          className="h-7 w-fit gap-1 px-2 text-xs"
        >
          <Icon icon="LocateFixed" size={12} className="size-3" />
          {tracking ? "추적 중" : "추적"}
        </Button>
      </div>

      <EquipmentIdentity object={object} status={status} />
      {settings && (
        <>
          {readOnly && (
            <p className="mt-3 text-xs text-text-secondary">
              모니터링에서는 설정을 조회할 수 있습니다.
            </p>
          )}
          <fieldset
            disabled={readOnly}
            aria-label={`${object.name} 설정`}
            className="min-w-0 disabled:opacity-60"
          >
            {settings}
          </fieldset>
        </>
      )}
      <DetailSection title="실시간 지표">{summary}</DetailSection>
      {children}
    </div>
  );
}
