import EditLibraryPanel from "@/ui/Hud/asset/EditLibraryPanel";
import SimulationPanel from "@/ui/Hud/simulation/SimulationPanel";
import { useSceneStore } from "@/stores/useSceneStore";

export default function WorkspacePanel() {
  const editing = useSceneStore((state) => state.editing);
  return editing ? <EditLibraryPanel /> : <SimulationPanel />;
}
