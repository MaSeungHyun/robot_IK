import { useSimulationStore } from "@/stores/useSimulationStore";
import { useJointAngleReadings } from "@/hooks/useJointAngleReadings";
import type { JointAngleRef } from "@/types/robot";

const format = (value: number) => (Math.abs(value) < 0.05 ? 0 : value).toFixed(1);
export default function JointAnglesPanel({ readings, onManualChange }: { readings: JointAngleRef; onManualChange: () => void }) {
  const angles = useSimulationStore(state => state.angles);
  const setAngles = useSimulationStore(state => state.setAngles);
  useJointAngleReadings(readings);
  const wrist = angles?.find(angle => angle.name === "hand04");
  return <section className="rounded-xl border border-slate-700 bg-slate-950/95 p-4 text-slate-100" aria-label="로봇 관절 각도 조정">
    <div className="font-semibold">관절 각도 조정</div>
    <div className="mt-1 text-xs text-slate-400">슬라이더: 블렌더 로컬 축 · 조정하면 자동 일시 정지</div>
    <div className="mt-1 text-xs text-slate-400">수동 자세 확인용 · hand03 고정 · 충돌 차단 없음</div>
    <div className="mt-3 space-y-2">
      {angles ? angles.map(angle => <label key={angle.name} className="block text-sm">
        <span className="flex justify-between gap-3"><span>{angle.name} <span className="text-xs text-slate-400">{angle.axis}축{angle.locked ? " · 고정" : ""}</span></span><span className="font-mono tabular-nums">{format(angle.degrees)}°</span></span>
        <input className="block w-full accent-blue-500 disabled:opacity-40" type="range" aria-label={angle.name + " 로컬 각도"}
          min={angle.min} max={angle.max} step={0.1} value={angle.degrees} disabled={angle.locked}
          onChange={event => {
            const degrees = Number(event.target.value);
            onManualChange();
            angle.setDegrees(degrees);
            setAngles(current => current?.map(row => row.name === angle.name ? {...row, degrees} : row) ?? null);
          }}/>
      </label>) : <div className="text-slate-400">로봇 불러오는 중…</div>}
    </div>
    {wrist?.worldXYZ && <div className="mt-3 border-t border-slate-700 pt-2 text-xs">
      <div>hand4 월드 XYZ (블렌더 축 · ZYX 분해)</div>
      <div className="mt-1 font-mono">{wrist.worldXYZ.map(value=>format(value)+"°").join(" / ")}</div>
      <div className="mt-2">수직 아래와의 기울기: <span className={wrist.downwardTilt !== undefined && wrist.downwardTilt <= 5 ? "text-green-400" : "text-amber-300"}>{wrist.downwardTilt === undefined ? "측정 불가" : format(wrist.downwardTilt)+"°"}</span></div>
      <div className="mt-1 text-slate-400">hand4 → GripPoint 방향 기준 · 0°면 수직 아래 · 5° 이내 초록 표시</div>
    </div>}
  </section>;
}
