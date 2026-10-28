import { useEffect } from "react";
import InfoTip from "@/components/InfoTip";
import { useSceneStore } from "@/stores/useSceneStore";
import { useShuttleZoneStore } from "@/stores/useShuttleZoneStore";
import type { StopRole } from "@/types/layout";
import { STOP_POINT_INFO } from "@/ui/Hud/equipment/details/_components/settingInfo";

export const STOP_ROLE_LABEL: Record<StopRole, string> = { unload: "하역 위치", service: "셔틀 교체 위치", ship: "출고 위치", stage: "출하 대기 위치", rackDrop: "Rack_m 하차 위치" };
export const STOP_ROLE_COLOR: Record<StopRole, string> = { unload: "#f59e0b", service: "#a78bfa", ship: "#22c55e", stage: "#38bdf8", rackDrop: "#f472b6" };

/** Robot/forklift/AMR stop points (replace placed docks): "<role> 지정" button (next floor click adds one) and the list. */
export default function StopPointSetting({ id, roles }: { id: string; roles: readonly StopRole[] }) {
  const points = useSceneStore((state) => state.settings[id]?.stopPoints);
  const editing = useSceneStore((state) => state.editing);
  const placingRole = useShuttleZoneStore((state) => (state.placingFor === id ? state.placingRole : null));
  const setPlacingFor = useShuttleZoneStore((state) => state.setPlacingFor);
  useEffect(() => () => { if (useShuttleZoneStore.getState().placingFor === id) setPlacingFor(null); }, [id, setPlacingFor]);
  useEffect(() => { if (!editing && placingRole) setPlacingFor(null); }, [editing, placingRole, setPlacingFor]);
  const remove = (index: number) => useSceneStore.getState().updateSettings(id, { stopPoints: (points ?? []).filter((_, i) => i !== index) });
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {roles.map((role) => (
          <button key={role} type="button" disabled={!editing} onClick={() => setPlacingFor(placingRole === role ? null : id, role)} className="rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40">
            {placingRole === role ? "바닥을 클릭하세요 (취소)" : `${STOP_ROLE_LABEL[role]} 지정`}
          </button>
        ))}
        <InfoTip text={STOP_POINT_INFO} label="정차 위치 설명" />
      </div>
      {(points ?? []).map((p, i) => (
        <div key={i} className="flex items-center justify-between text-xs">
          <span style={{ color: STOP_ROLE_COLOR[p.role] }}>{STOP_ROLE_LABEL[p.role]} · ({p.x.toFixed(2)}, {p.z.toFixed(2)}){p.acceptGrade && p.acceptGrade !== "any" ? ` · ${p.acceptGrade === "defect" ? "불량" : "정상"}` : ""}</span>
          <button type="button" disabled={!editing} onClick={() => remove(i)} className="px-1 opacity-70 hover:opacity-100 disabled:opacity-30">삭제</button>
        </div>
      ))}
    </div>
  );
}