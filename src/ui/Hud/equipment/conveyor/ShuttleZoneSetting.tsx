import { useEffect } from "react";
import InfoTip from "@/components/InfoTip";
import { useSceneStore } from "@/stores/useSceneStore";
import { useShuttleZoneStore } from "@/stores/useShuttleZoneStore";
import { SHUTTLE_ZONE_INFO } from "@/ui/Hud/equipment/details/_components/settingInfo";

/** Pallet-inbound conveyor: 셔틀 구역 지정 button (next floor click adds a zone) and the zone list. */
export default function ShuttleZoneSetting({ id }: { id: string }) {
  const zones = useSceneStore((state) => state.settings[id]?.shuttleZones);
  const editing = useSceneStore((state) => state.editing);
  const placing = useShuttleZoneStore((state) => state.placingFor === id);
  const setPlacingFor = useShuttleZoneStore((state) => state.setPlacingFor);
  useEffect(() => () => { if (useShuttleZoneStore.getState().placingFor === id) setPlacingFor(null); }, [id, setPlacingFor]);
  useEffect(() => { if (!editing && placing) setPlacingFor(null); }, [editing, placing, setPlacingFor]);
  const remove = (index: number) => useSceneStore.getState().updateSettings(id, { shuttleZones: (zones ?? []).filter((_, i) => i !== index) });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button type="button" disabled={!editing} onClick={() => setPlacingFor(placing ? null : id)} className="rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40">
          {placing ? "바닥을 클릭하세요 (취소)" : "셔틀 구역 지정"}
        </button>
        <InfoTip text={SHUTTLE_ZONE_INFO} label="셔틀 구역 설명" />
      </div>
      {(zones ?? []).map((z, i) => (
        <div key={i} className="flex items-center justify-between text-xs">
          <span>셔틀 구역 {i + 1} · ({z.x.toFixed(2)}, {z.z.toFixed(2)})</span>
          <button type="button" disabled={!editing} onClick={() => remove(i)} className="px-1 opacity-70 hover:opacity-100 disabled:opacity-30">삭제</button>
        </div>
      ))}
    </div>
  );
}
