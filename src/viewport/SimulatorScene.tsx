import InstancedScene from "@/viewport/instancing/InstancedScene";
import SceneEditor from "@/viewport/editor/SceneEditor";
import FactoryRun from "@/viewport/simulation/FactoryRun";
import { useSceneStore } from "@/stores/useSceneStore";
import type { SimulatorRunProps } from "@/viewport/simulation/types";
import ObjectTrackingTarget from "@/viewport/tracking/ObjectTrackingTarget";

type Props = SimulatorRunProps & { simulationRun: number };

export default function SimulatorScene({ simulationRun, ...props }: Props) {
  const editing = useSceneStore((state) => state.editing);

  return (
    <InstancedScene>
      {editing ? <SceneEditor /> : <FactoryRun key={simulationRun} {...props} />}
      <ObjectTrackingTarget />
    </InstancedScene>
  );
}
