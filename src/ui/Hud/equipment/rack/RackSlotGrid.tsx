import { useMemo } from "react";
import { RACK_CONFIG } from "@/constants/rack";
import { useSimulationStore } from "@/stores/useSimulationStore";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import { cn } from "@/lib/style";
import { fmtTime } from "@/ui/Hud/dashboard/full/format";

const GRADE_LABEL = { normal: "정상", defect: "불량" } as const;

type Slot = NonNullable<
  NonNullable<ReturnType<typeof useSimulationStore.getState>["equipment"]>["racks"]
>[number]["slots"][number];

/**
 * Real rack layout from the model's slot points: columns = distinct z (left to right as seen
 * from the loading face), rows = distinct shelf heights (top level first).
 */
function rackLayout() {
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

/** Rack slot grid (levels x bays) like the pallet slot view: occupancy, pallet id and box count. */
export default function RackSlotGrid({ rackId }: { rackId: string }) {
  const slots = useSimulationStore(
    (state) => state.equipment?.racks?.find((rack) => rack.id === rackId)?.slots,
  );
  const { columns, levels, cells } = useMemo(() => rackLayout(), []);
  const stored = slots?.filter((slot) => slot.state === "stored").length ?? 0;
  const reserved = slots?.filter((slot) => slot.state === "reserved").length ?? 0;
  const storedList = (slots ?? [])
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.state === "stored")
    .sort((a, b) => (a.slot.storedAt ?? 0) - (b.slot.storedAt ?? 0));

  return (
    <DetailSection
      title={`보관 칸 · ${stored}/${RACK_CONFIG.slots.length}${reserved ? ` · 예약 ${reserved}` : ""}`}
    >
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        aria-label={`랙 보관 칸 ${levels}단 x ${columns}열`}
      >
        {cells.map((index, i) => {
          if (index < 0) return <div key={`gap-${i}`} />;
          const slot: Slot = slots?.[index] ?? { state: "empty" };
          const level = levels - Math.floor(i / columns);
          const detail = [
            `슬롯 ${index + 1} · ${level}단`,
            STATE_LABEL[slot.state],
            slot.palletId && `팔레트 ${slot.palletId}`,
            slot.boxes !== undefined && `박스 ${slot.boxes}개`,
            slot.grade && GRADE_LABEL[slot.grade],
            slot.storedAt !== undefined && `보관 ${fmtTime(slot.storedAt)}`,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={index}
              title={detail}
              className={cn(
                "flex h-12 flex-col justify-center rounded-[3px] border px-1.5 text-[10px] leading-tight tabular-nums",
                slot.state === "stored" && "border-operating/30 bg-operating/10 text-text-primary",
                slot.state === "reserved" && "border-dashed border-warning/50 bg-warning/5 text-warning",
                slot.state === "empty" && "border-white/10 text-text-secondary",
              )}
            >
              <span className="text-text-secondary">#{index + 1}</span>
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
        })}
      </div>
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