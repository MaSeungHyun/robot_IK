import Select from "@/components/Select";
import { BOX_COUNT } from "@/legacy/robot/RobotDemo";
import { useSimulationStore } from "@/stores/useSimulationStore";
import type { SimulationSceneMode } from "@/types/simulation";

const DEMOS: readonly { value: SimulationSceneMode; label: string }[] = [
  { value: "robot", label: `Robot · 박스 ${BOX_COUNT}개` },
  { value: "conveyor", label: "Conveyor · 팔레타이징" },
  { value: "amr", label: "AMR · 창고 이송" },
  { value: "simulator", label: "Simulator · 공장 시뮬레이터" },
];

export default function DemoSelect() {
  const sceneMode = useSimulationStore(state => state.sceneMode);
  const setSceneMode = useSimulationStore(state => state.setSceneMode);
  return <Select label="데모 선택" value={sceneMode} options={DEMOS} onValueChange={setSceneMode} />;
}
