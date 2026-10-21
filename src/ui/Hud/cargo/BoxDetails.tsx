import { useCargoStore } from "@/stores/useCargoStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { useCameraTrackingStore } from "@/stores/useCameraTrackingStore";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import type { BoxEventType, BoxState } from "@/domain/cargo/CargoRegistry";

const BOX_STATE_LABEL: Record<BoxState, string> = {
  conveyor: "컨베이어 이동",
  robot: "로봇 집기",
  pallet: "팔레트 적재",
  amr: "AMR 운반",
  rack: "랙 보관",
  dock: "출고 구역",
  shipped: "출하 완료",
  passed: "라인 통과 (미처리)",
};
const EVENT_LABEL: Record<BoxEventType, string> = {
  spawn: "투입",
  scan: "검사",
  reserve: "집기 배정",
  pick: "집기",
  place: "팔레트 적재",
  miss: "집기 실패",
  pass: "라인 통과",
  dispatch: "AMR 배차",
  store: "랙 보관",
  drop: "출고 구역 하차",
  ship: "출하",
};

export default function BoxDetails({ id }: { id: string }) {
  // Re-renders only at the throttled registry refresh rate.
  useCargoStore((state) => state.version);
  const box = useCargoStore((state) => state.registry)?.box(id);
  const objects = useSceneStore((state) => state.objects);
  const tracking = useCameraTrackingStore((state) => state.trackedId === id);
  const toggleTracking = useCameraTrackingStore((state) => state.toggle);
  const name = (equipmentId: string | null | undefined) =>
    equipmentId ? (objects.find((object) => object.id === equipmentId)?.name ?? equipmentId) : "-";

  if (!box)
    return (
      <>
        <h2 className="text-sm font-semibold">{id}</h2>
        <p className="mt-3 text-xs text-text-secondary">박스 기록이 없습니다.</p>
      </>
    );
  const live = box.state !== "shipped" && box.state !== "passed";
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-text-primary">{box.id} <span className="text-text-secondary">· 박스</span></h2>
        {live && (
          <button
            type="button"
            className="h-6 rounded-[3px] border border-white/10 px-2 text-[11px] text-text-secondary hover:bg-white/5"
            onClick={() => toggleTracking(box.id)}
          >
            {tracking ? "추적 해제" : "카메라 추적"}
          </button>
        )}
      </div>
      <DetailSection title="정보">
      <DetailRows
        rows={[
          { label: "검사 결과", value: box.inspection === null ? "미검사" : box.inspection === "defect" ? "불량" : "정상" },
          { label: "상태", value: BOX_STATE_LABEL[box.state] },
          { label: "현재 위치", value: name(box.holder) },
          { label: "팔레트", value: box.palletId ?? "-" },
          { label: "투입 시각", value: `${box.spawnedAt.toFixed(1)}s` },
          ...(box.destination ? [{ label: "목적지", value: box.destination }] : []),
        ]}
      />
      </DetailSection>
      <DetailSection title={`이력 (${box.history.length})`}>
        <ol className="space-y-1">
          {box.history.map((event, index) => (
            <li key={index} className="flex gap-2">
              <span className="w-12 shrink-0 tabular-nums">{event.t.toFixed(1)}s</span>
              <span className="text-text-primary">{EVENT_LABEL[event.type]}</span>
              <span className="truncate">
                {[event.equipmentId && name(event.equipmentId), event.palletId, event.detail].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      </DetailSection>
    </>
  );
}
