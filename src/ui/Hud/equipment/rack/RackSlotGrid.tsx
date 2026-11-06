import { useMemo } from "react";
import { RACK_CONFIG } from "@/constants/rack";
import { RACK_M_MODEL } from "@/constants/cycle";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useSceneStore } from "@/stores/useSceneStore";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import { cn } from "@/lib/style";
import { fmtTime } from "@/ui/Hud/dashboard/full/format";

const GRADE_LABEL = { normal: "정상", defect: "불량" } as const;
const CONTENT_LABEL = { pallet: "빈 팔레트", palletBoxes: "팔레트+박스", boxes: "박스만" } as const;

type Slot = NonNullable<
  NonNullable<ReturnType<typeof useSimulationStore.getState>["equipment"]>["racks"]
>[number]["slots"][number];

/**
 * Real rack layout from the model's slot points: columns = distinct z (left to right as seen
 * from the loading face), rows = distinct shelf heights (top level first).
 */
function fixedRackLayout() {
  // Slot point coordinates come from the model and differ by a few mm between bays, so exact
  // Set() matching split one shelf into several rows. Snap to 5 cm before grouping.
  const snap = (value: number) => Math.round(value / 0.05);
  // Seen from the +X loading face, left is +Z.
  const xs = [...new Set(RACK_CONFIG.slots.map(({ z }) => snap(z)))].sort((a, b) => b - a);
  const ys = [...new Set(RACK_CONFIG.slots.map(({ y }) => snap(y)))].sort((a, b) => b - a);
  const cells = ys.flatMap((y) =>
    xs.map((x) => RACK_CONFIG.slots.findIndex((slot) => snap(slot.z) === x && snap(slot.y) === y)),
  );
  return { columns: xs.length, levels: ys.length, cells };
}

const STATE_LABEL = { empty: "비어 있음", reserved: "예약됨 (운반 중)", stored: "보관 중" } as const;

function SlotCell({ index, levelLabel, slot }: { index: number; levelLabel: string; slot: Slot }) {
  const detail = [
    `슬롯 ${index + 1} · ${levelLabel}`,
    STATE_LABEL[slot.state],
    slot.content && CONTENT_LABEL[slot.content],
    slot.palletId && `팔레트 ${slot.palletId}`,
    slot.boxes !== undefined && `박스 ${slot.boxes}개`,
    slot.grade && GRADE_LABEL[slot.grade],
    slot.storedAt !== undefined && `보관 ${fmtTime(slot.storedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      title={detail}
      className={cn(
        "flex h-12 flex-col justify-center rounded-[3px] border px-1.5 text-[10px] leading-tight tabular-nums",
        slot.state === "stored" && "border-operating/30 bg-operating/10 text-text-primary",
        slot.state === "reserved" && "border-dashed border-warning/50 bg-warning/5 text-warning",
        slot.state === "empty" && "border-white/10 text-text-secondary",
      )}
    >
      <span className="text-text-secondary">#{index + 1} · {levelLabel}</span>
      <span className="truncate">
        {slot.state === "empty"
          ? "—"
          : slot.palletId ?? (slot.state === "reserved" ? "예약" : "보관")}
      </span>
      {slot.state !== "empty" && slot.boxes !== undefined && (
        <span className={cn("text-text-secondary", slot.grade === "defect" && "text-fault")}>
          {slot.boxes}개{slot.grade ? ` · ${GRADE_LABEL[slot.grade]}` : ""}
        </span>
      )}
    </div>
  );
}

/** Rack slot grid: fixed racks = model bay×shelf; Rack_m = vertical 3 levels (만재 시 AGV). */
export default function RackSlotGrid({ rackId }: { rackId: string }) {
  const mobile = useSceneStore((state) => state.settings[rackId]?.rackType === "mobile");
  const slots = useSimulationStore(
    (state) => state.equipment?.racks?.find((rack) => rack.id === rackId)?.slots,
  );
  const fixed = useMemo(() => fixedRackLayout(), []);
  const mobileLevels = RACK_M_MODEL.levels.length;
  const total = mobile ? mobileLevels : RACK_CONFIG.slots.length;
  const stored = slots?.filter((slot) => slot.state === "stored").length ?? 0;
  const reserved = slots?.filter((slot) => slot.state === "reserved").length ?? 0;
  const storedList = (slots ?? [])
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.state === "stored")
    .sort((a, b) => (a.slot.storedAt ?? 0) - (b.slot.storedAt ?? 0));

  return (
    <DetailSection
      title={`보관 칸 · ${stored}/${total}${reserved ? ` · 예약 ${reserved}` : ""}${mobile ? " · 만재 시 AGV" : ""}`}
    >
      {mobile ? (
        <div className="grid grid-cols-1 gap-1" aria-label={`이동식 랙 보관 칸 ${mobileLevels}단`}>
          {/* Top shelf first (level n → 1). */}
          {Array.from({ length: mobileLevels }, (_, row) => {
            const index = mobileLevels - 1 - row;
            const slot: Slot = slots?.[index] ?? { state: "empty" };
            return <SlotCell key={index} index={index} levelLabel={`${index + 1}단`} slot={slot} />;
          })}
        </div>
      ) : (
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${fixed.columns}, minmax(0, 1fr))` }}
          aria-label={`랙 보관 칸 ${fixed.levels}단 x ${fixed.columns}열`}
        >
          {fixed.cells.map((index, i) => {
            if (index < 0) return <div key={`gap-${i}`} />;
            const slot: Slot = slots?.[index] ?? { state: "empty" };
            const level = fixed.levels - Math.floor(i / fixed.columns);
            return <SlotCell key={index} index={index} levelLabel={`${level}단`} slot={slot} />;
          })}
        </div>
      )}
      {storedList.length > 0 && (
        <table className="mt-3 w-full border-collapse text-left text-[11px] tabular-nums">
          <thead className="text-text-secondary">
            <tr>
              {["팔레트 ID", "칸", "박스", "용도", "보관 시각"].map((h) => (
                <th key={h} className="border-b border-white/10 px-1.5 py-1 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {storedList.map(({ slot, index }) => (
              <tr key={index} className="border-b border-white/5 text-text-primary">
                <td className="px-1.5 py-1">{slot.palletId ?? "—"}</td>
                <td className="px-1.5 py-1 text-text-secondary">#{index + 1}</td>
                <td className="px-1.5 py-1">{slot.boxes ?? "—"}</td>
                <td className={cn("px-1.5 py-1", slot.grade === "defect" ? "text-fault" : "text-text-secondary")}>
                  {slot.grade ? GRADE_LABEL[slot.grade] : "—"}
                </td>
                <td className="px-1.5 py-1 text-text-secondary">{fmtTime(slot.storedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!slots && <p className="mt-1 text-[11px] text-text-secondary">시뮬레이션을 실행하면 보관 현황이 표시됩니다.</p>}
    </DetailSection>
  );
}
