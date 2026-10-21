import Panel from "@/ui/Hud/_components/Panel";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useSceneStore } from "@/stores/useSceneStore";

import PlaybackSpeedSelect from "@/ui/Hud/simulation/PlaybackSpeedSelect";
import ShadowQualitySelect from "@/ui/Hud/simulation/ShadowQualitySelect";
import SimulationControls from "@/ui/Hud/simulation/SimulationControls";
import SimulationHeader from "@/ui/Hud/simulation/SimulationHeader";
import SimulationStatsPanel from "@/ui/Hud/simulation/SimulationStatsPanel";
import Button from "@/components/Button";
import Icon from "@/components/Icon";
import { useHudStore } from "@/stores/useHudStore";

export default function SimulationPanel() {
  const closePanel = useHudStore((state) => state.closeWorkspacePanel);
  const sceneMode = useSimulationStore((state) => state.sceneMode);
  const editing = useSceneStore((state) => state.editing);
  const isEditing = sceneMode === "simulator" && editing;

  return (
    <Panel aria-label="시뮬레이션 제어" className="shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <SimulationHeader />
        <Button
          aria-label="Play 패널 닫기"
          className="size-6 shrink-0 px-0"
          onClick={closePanel}
        >
          <Icon icon="X" />
        </Button>
      </div>
      <PlaybackSpeedSelect />
      <ShadowQualitySelect />
      <SimulationStatsPanel />

      {!isEditing && <SimulationControls />}
    </Panel>
  );
}
