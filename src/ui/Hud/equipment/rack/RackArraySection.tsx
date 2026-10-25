import { useState } from "react";
import Button from "@/components/Button";
import NumberField from "@/components/NumberField";
import Select from "@/components/Select";
import { RACK_M_MODEL } from "@/constants/cycle";
import { RACK_CONFIG } from "@/constants/rack";
import type { ArrayAxis } from "@/domain/layout/arrayPlacement";
import { useSceneStore } from "@/stores/useSceneStore";
import type { SceneEquipment } from "@/types/layout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";

const AXES = [
  { value: "z", label: "세로 (랙 길이 방향, 로컬 Z)" },
  { value: "x", label: "가로 (적재면 방향, 로컬 X)" },
] as const;

/** '배열 복제' (Blender Array): count incl. this rack, gap between frames, direction; each copy is its own rack, one undo step. */
export default function RackArraySection({ object }: { object: SceneEquipment }) {
  const editing = useSceneStore((state) => state.editing);
  const mobile = useSceneStore((state) => state.settings[object.id]?.rackType === "mobile");
  const arrayCopies = useSceneStore((state) => state.arrayCopies);
  const [count, setCount] = useState(3);
  const [gap, setGap] = useState(0.5);
  const [axis, setAxis] = useState<ArrayAxis>("z");
  if (!editing) return null;
  const footprint: [number, number] = mobile ? [RACK_M_MODEL.width, RACK_M_MODEL.depth] : RACK_CONFIG.footprint;
  return (
    <DetailSection title="배열 복제">
      <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
        <label className="block">개수 (이 랙 포함)<NumberField label="배열 개수" value={count} integer min={2} max={50} onCommit={setCount} /></label>
        <label className="block">간격<NumberField label="배열 간격" value={gap} unit="m" decimals={2} onCommit={setGap} /></label>
      </div>
      <div className="mt-2 text-xs text-text-secondary">
        <p className="mb-1">방향</p>
        <Select label="배열 방향" value={axis} options={AXES} onValueChange={setAxis} />
      </div>
      <Button className="mt-2 w-full" onClick={() => arrayCopies(object.id, footprint, { count, gap, axis })}>
        {count - 1}개 복제 배치
      </Button>
    </DetailSection>
  );
}
