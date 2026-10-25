import type { ReactNode } from "react";
import Button from "@/components/Button";
import EquipmentIdentity from "@/ui/Hud/equipment/details/EquipmentIdentity";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import LinkSection from "@/ui/Hud/equipment/details/_components/LinkSection";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import { useSceneStore } from "@/stores/useSceneStore";
import { useHudStore } from "@/stores/useHudStore";
import Icon from "@/components/Icon";
import { useCameraTrackingStore } from "@/stores/useCameraTrackingStore";
import CycleStateSection from "@/ui/Hud/equipment/cycle/CycleStateSection";
import { useSettingsOnly } from "@/ui/Hud/equipment/details/_components/playLockState";

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
  const tracking = useCameraTrackingStore((state) => state.trackedId === object.id);
  const toggleTracking = useCameraTrackingStore((state) => state.toggle);
  const settingsOnly = useSettingsOnly();
  const settingsBlock = settings && (
    <fieldset aria-label={`${object.name} 설정`} className="min-w-0">
      {settings}
    </fieldset>
  );

  // Editor properties panel: the very same settings (and cycle state) as Play, without telemetry/links.
  if (settingsOnly)
    return (
      <div className="min-w-0">
        {settingsBlock}
        <CycleStateSection id={object.id} />
      </div>
    );

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
          onClick={() => toggleTracking(object.id)}
          className="h-6 w-fit gap-1 rounded-[3px] px-2 text-[11px]"
        >
          <Icon icon="LocateFixed" size={12} className="size-3" />
          {tracking ? "추적 중" : "추적"}
        </Button>
      </div>

      <EquipmentIdentity object={object} status={status} />
      {settingsBlock}
      <CycleStateSection id={object.id} />
      <DetailSection title="실시간 지표">{summary}</DetailSection>
      <LinkSection object={object} />
      {children}
    </div>
  );
}
