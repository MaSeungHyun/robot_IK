import Select from "@/components/Select";
import { useSimulationStore } from "@/stores/useSimulationStore";
import type { RobotTransferMode } from "@/types/robot";

const TRANSFERS: readonly { value: RobotTransferMode; label: string }[] = [
  { value: "base", label: "베이스 회전" },
  { value: "shoulder", label: "후방 넘기기" },
];

export default function TransferModeSelect() {
  const transferMode = useSimulationStore((state) => state.transferMode);
  const setTransferMode = useSimulationStore((state) => state.setTransferMode);
  return (
    <div className="mt-5">
      <p className="mb-2 text-xs text-text-secondary">이송 방식</p>
      <Select
        label="이송 방식"
        value={transferMode}
        options={TRANSFERS}
        onValueChange={setTransferMode}
      />
    </div>
  );
}
