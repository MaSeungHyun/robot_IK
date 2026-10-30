import { bulkTargets } from "@/stores/actions/applyEquipmentSettings";
import { useShallow } from "zustand/react/shallow";
import { BulkNumber } from "@/ui/Hud/object/BulkField";
import { DETAIL_INPUT_CLASS_NAME } from "@/ui/Hud/equipment/details/styles";
import { useSceneStore } from "@/stores/useSceneStore";

import {
  amrSpeedOf, beltSpeedOf, fromBoxesPerHour, spawnIntervalOf, speedPatch,
  toBoxesPerHour,
} from "@/domain/simulation/equipmentSpeeds";
import type { EquipmentSettings } from "@/types/layout";
import { deckFeedIntervalOf, stackCapacityOf } from "@/constants/emptyPallet";

type Field = "speed" | "reach" | "capacity" | "spawnInterval" | "beltSpeed" | "amrSpeed" | "stackCapacity" | "deckFeedInterval" | "robotPedestalYaw";
import { NUMBER_INFO } from "@/ui/Hud/equipment/details/_components/settingInfo";

type Props = {
  id: string;
  field: Field;
  label: string;
  unit?: string;
  min: number;
  max?: number;
  exclusiveMin?: boolean;
  integer?: boolean;
  /** Kept for call-site compatibility; free typing ignores steps. */
  step?: number;
  info?: React.ReactNode;
};

function read(field: Field, config: EquipmentSettings) {
  // Display units: belt m/s (as stored), box feed boxes/h (stored as seconds).
  if (field === "beltSpeed") return beltSpeedOf(config);
  if (field === "amrSpeed") return amrSpeedOf(config);
  if (field === "spawnInterval") return toBoxesPerHour(spawnIntervalOf(config));
  if (field === "stackCapacity") return stackCapacityOf(config);
  if (field === "deckFeedInterval") return deckFeedIntervalOf(config);
  if (field === "robotPedestalYaw") return config.robotPedestalYaw ?? 0;
  return config[field];
}

function write(field: Field, value: number, config: EquipmentSettings): Partial<EquipmentSettings> {
  if (field === "beltSpeed") return speedPatch(field, value, config);
  if (field === "spawnInterval") return speedPatch(field, fromBoxesPerHour(value), config);
  if (field === "amrSpeed") return speedPatch(field, value, config);
  return { [field]: value };
}

/** Number setting with "혼합" multi-edit (same-kind selection) and a per-field "일괄 적용" button. */
export default function EquipmentNumberSetting({ id, field, label, unit, min, max, exclusiveMin, integer = false, info }: Props) {
  const ids = useSceneStore(useShallow((state) => bulkTargets(state, id)));
  const kind = useSceneStore((state) => state.objects.find((o) => o.id === id)?.kind);
  if (!kind) return null;
  return (
    <BulkNumber
      ids={ids}
      kind={kind}
      label={label}
      info={info ?? NUMBER_INFO[field]}
      unit={unit}
      min={min}
      max={max}
      exclusiveMin={exclusiveMin}
      integer={integer}
      decimals={2}
      inputClassName={DETAIL_INPUT_CLASS_NAME}
      read={(config) => read(field, config)}
      write={(value, config) => write(field, value, config)}
    />
  );
}