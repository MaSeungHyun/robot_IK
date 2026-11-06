import { useEffect } from "react";
import { useSceneStore } from "@/stores/useSceneStore";
import { useAgvPathStore } from "@/stores/useAgvPathStore";
import { useShuttleZoneStore } from "@/stores/useShuttleZoneStore";

export const AGV_PATH_COLOR = "#f472b6";
const BUTTON = "rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40";

/** AGV 경로: "경로 추가" (바닥 클릭으로 점 추가, Enter/Esc·완료로 종료). 그리는 동안 다른 설비 선택은 막힘. */
export default function AgvPathSetting({ id }: { id: string }) {
  const path = useSceneStore((state) => state.settings[id]?.agvPath);
  const editing = useSceneStore((state) => state.editing);
  const drawing = useAgvPathStore((state) => state.drawingFor === id);
  const setDrawingFor = useAgvPathStore((state) => state.setDrawingFor);
  // Do not clear drawing when this panel unmounts (e.g. a stray select) — only leave edit mode or finish explicitly.
  useEffect(() => { if (!editing && drawing) setDrawingFor(null); }, [editing, drawing, setDrawingFor]);
  const points = path ?? [];
  const update = (next: { x: number; z: number }[]) => useSceneStore.getState().updateSettings(id, { agvPath: next });
  const toggle = () => {
    useShuttleZoneStore.getState().setPlacingFor(null);
    if (drawing) setDrawingFor(null);
    else {
      useSceneStore.getState().select(id);
      setDrawingFor(id);
    }
  };
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" disabled={!editing} onClick={toggle} className={BUTTON}>{drawing ? "완료" : "경로 추가"}</button>
        <button type="button" disabled={!editing || !points.length} onClick={() => update(points.slice(0, -1))} className={BUTTON}>마지막 점 취소</button>
        <button type="button" disabled={!editing || !points.length} onClick={() => { update([]); }} className={BUTTON}>경로 지우기</button>
      </div>
      <div className="text-xs opacity-70">
        {drawing ? `바닥 클릭으로 점 추가 · Enter 또는 Esc로 종료 · 점 ${points.length}개 (그리는 동안 다른 설비 선택 불가)`
          : points.length ? `경로 점 ${points.length}개 · Rack_m을 이 경로로 운반합니다 (복귀는 역순)` : "경로 없음(권장) · 없어도 자동 경로로 운반 · 하차 위치는 필수"}
      </div>
    </div>
  );
}
