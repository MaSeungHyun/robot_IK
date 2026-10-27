import { useMemo } from "react";
import { useGLTF } from "@/lib/three/gltfLoader";
import { conveyorArrows, conveyorTemplate } from "@/objects/conveyor/conveyorTemplate";
import { PATH_SOURCES, pathConveyorModel, railInOutLength, railInOutModel, railInOutUrl } from "@/objects/conveyor/glbConveyors";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { MODEL } from "@/viewport/models/modelUrls";
import type { SceneEquipment } from "@/types/layout";
import type { ConveyorPathId } from "@/domain/conveyor/conveyorPaths";
import { CONVEYOR_LAYOUT } from "@/constants/conveyorLayoutConfig";
import { useSceneStore } from "@/stores/useSceneStore";

/** Spline conveyor: the whole glb rail (never split); boxes follow its extracted centreline. */
function PathConveyor({ path }: { path: ConveyorPathId }) {
  const { scene } = useGLTF(PATH_SOURCES[path].url);
  const model = useMemo(() => pathConveyorModel(path, scene), [path, scene]);
  return <primitive object={model} dispose={null} />;
}

/** 입하/출하 straight: rail_in_out.glb at native scale/length (rail.glb when the asset is absent). */
function RailInOut({ url, length }: { url: string; length: number }) {
  const { scene } = useGLTF(url);
  const model = useMemo(() => railInOutModel(scene), [scene]);
  useMemo(() => { const native = railInOutLength(scene); if (Math.abs(native - length) > 0.01) console.warn(`[ConveyorBelt] conveyorLength ${length} ≠ rail_in_out.glb native ${native.toFixed(4)} m; model is not stretched`); }, [scene, length]);
  return <primitive object={model} dispose={null} />;
}

function RailBelt({ entity }: { entity: SceneEquipment }) {
  const turn = entity.conveyorTurn;
  const { scene: rail } = useGLTF(MODEL.rail);
  const role = useSceneStore((state) => state.settings[entity.id]?.conveyorRole ?? "box");
  const stretch = (!turn || turn === "straight") && entity.conveyorLength ? entity.conveyorLength / CONVEYOR_LAYOUT.length : 1;
  const model = useMemo(() => { const m = conveyorTemplate(turn, rail, role).clone(true); m.scale.z = stretch; return m; }, [turn, rail, role, stretch]);
  useInstanceModel(model, true);
  // Flow arrows: edit mode only (hidden while Play runs), separate from the instanced belt.
  const editing = useSceneStore((state) => state.editing);
  const arrows = useMemo(() => { const a = conveyorArrows(turn, role).clone(true); a.scale.z = stretch; return a; }, [turn, role, stretch]);
  return (
    <>
      <primitive object={model} dispose={null} />
      {editing && <primitive object={arrows} dispose={null} />}
    </>
  );
}

export default function ConveyorBelt({ entity }: { entity: SceneEquipment }) {
  if (entity.conveyorPath) return <PathConveyor path={entity.conveyorPath} />;
  if (entity.conveyorLength && railInOutUrl && (entity.conveyorTurn ?? "straight") === "straight") return <RailInOut url={railInOutUrl} length={entity.conveyorLength} />;
  return <RailBelt entity={entity} />;
}