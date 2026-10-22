import Select from "@/components/Select";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";

const OPTIONS: readonly { value: "on" | "off"; label: string }[] = [
  { value: "on", label: "표시" },
  { value: "off", label: "숨김" },
];

export default function CeilingSelect() {
  const ceiling = useViewportSettingsStore((state) => state.ceiling);
  const setCeiling = useViewportSettingsStore((state) => state.setCeiling);
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs text-text-secondary">천장</p>
      <Select label="천장" value={ceiling ? "on" : "off"} options={OPTIONS} onValueChange={(value) => setCeiling(value === "on")} />
    </div>
  );
}
