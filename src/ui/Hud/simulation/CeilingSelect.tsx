import InfoTip from "@/components/InfoTip";
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
      <p className="mb-2 flex items-center text-xs text-text-secondary">천장<InfoTip label="천장 설명" text="천장 메시 표시 여부입니다. 위에서 내려다보며 배치할 때는 숨기세요. 시뮬레이션 결과에는 영향이 없습니다." /></p>
      <Select label="천장" value={ceiling ? "on" : "off"} options={OPTIONS} onValueChange={(value) => setCeiling(value === "on")} />
    </div>
  );
}
