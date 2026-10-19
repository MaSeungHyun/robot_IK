import EditLibraryPanel from "@/features/Hud/asset/EditLibraryPanel";
import SimulationPanel from "@/features/Hud/simulation/SimulationPanel";
import { useSceneStore } from "@/stores/useSceneStore";

export default function WorkspacePanel() {
  const editing = useSceneStore((state) => state.editing);
  return editing ? <EditLibraryPanel /> : <SimulationPanel />;
}
