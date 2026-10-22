import { EQUIPMENT_REPORT_INTERVAL_MS } from "@/constants/telemetry";
import { cn } from "@/lib/style";
import SmoothValue from "@/ui/Hud/equipment/details/_components/SmoothValue";
import { fixed } from "@/ui/Hud/line/_components/format";
import { formatMetric } from "@/utils/equipment/formatMetric";

type Props = {
  output: number;
  availability: number | undefined;
  quality: number | undefined;
  oee: number | undefined;
};

/** The four KPI tiles: total output, availability, quality, OEE. */
export default function LineSummaryTiles({
  output,
  availability,
  quality,
  oee,
}: Props) {
  const smooth = (value: number | undefined) => (
    <SmoothValue
      value={value}
      format={fixed("%")}
      intervalMs={EQUIPMENT_REPORT_INTERVAL_MS}
    />
  );
  const tiles = [
    {
      label: "총 생산량",
      value: (
        <span className="tabular-nums">{formatMetric(output, "개", 0)}</span>
      ),
      tone: "text-brand-primary",
    },
    { label: "가동률", value: smooth(availability), tone: "text-safe" },
    { label: "품질", value: smooth(quality), tone: "text-info" },
    { label: "OEE", value: smooth(oee), tone: "text-warning" },
  ];
  return (
    <div className="mt-2 grid grid-cols-4 gap-1.5">
      {tiles.map(({ label, value, tone }) => (
        <div key={label} className="rounded-lg bg-white/[0.035] px-2 py-1.5">
          <p className="text-xs text-text-secondary">{label}</p>
          <p
            className={cn(
              "mt-0.5 text-lg font-semibold tabular-nums text-right",
              tone,
            )}
          >
            {value ?? "—"}
          </p>
        </div>
      ))}
    </div>
  );
}
