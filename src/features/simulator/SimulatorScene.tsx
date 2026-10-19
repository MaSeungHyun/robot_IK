import InstancedScene from "@/features/Viewport/instancing/InstancedScene";
import SceneEditor from "@/features/simulator/editor/SceneEditor";
import FactoryRun from "@/features/simulator/runtime/FactoryRun";
import { useSceneStore } from "@/stores/useSceneStore";
import type { SimulatorRunProps } from "@/features/simulator/runtime/types";

type Props = SimulatorRunProps & { simulationRun: number };

export default function SimulatorScene({ simulationRun, ...props }: Props) {
  const editing = useSceneStore((state) => state.editing);

  return (
    <InstancedScene>
      {editing ? <SceneEditor /> : <FactoryRun key={simulationRun} {...props} />}
    </InstancedScene>
  );
}
