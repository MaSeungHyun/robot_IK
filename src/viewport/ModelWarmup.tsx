import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Group, InstancedMesh, Mesh, type Material, type Object3D, type Texture } from "three";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { geometryAtScale } from "@/lib/three/geometryAtScale";
import { conveyorTemplate } from "@/objects/conveyor/conveyorTemplate";
import { log } from "@/stores/useLogStore";
import { useModelStore } from "@/stores/useModelStore";
import { useWarmupStore } from "@/stores/useWarmupStore";
import { buildConveyorGhost, buildModelGhost, type GhostModelKind } from "@/viewport/editor/ghostModels";
import { useModelsSettled } from "@/stores/useModelStore";
import { MODEL, MODEL_URLS } from "@/viewport/models/modelUrls";
import type { ConveyorTurn } from "@/types/layout";

const TURNS: ConveyorTurn[] = ["straight", "left", "right"];
const GHOSTS: GhostModelKind[] = ["robot", "pallet", "amr", "scanner", "rack"];
/**
 * Ghost previews built at warm-up are kept alive (never disposed) so their compiled shader
 * programs stay cached; placement ghosts created later reuse them and show on the first drag.
 */
const keepAlive: Object3D[] = [];
let started = false;

/**
 * Compiles the shader programs of every loaded equipment material (plain, instanced and
 * translucent ghost variants, with this scene's lights) and uploads their textures once at
 * startup. Failed models are skipped. Marks the app ready. Renders nothing.
 */
export default function ModelWarmup() {
  const settled = useModelsSettled();
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    if (!settled || started) return;
    started = true;
    const ready = useWarmupStore.getState().setReady;
    const scenes = useModelStore.getState().scenes;
    const root = new Group();
    const textures = new Set<Texture>();
    const instanced: InstancedMesh[] = [];
    const addWithInstances = (model: Object3D) => {
      root.add(model);
      model.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        // SceneInstances draws equipment as InstancedMesh, a separate program variant.
        const mesh = new InstancedMesh(node.geometry, node.material, 1);
        instanced.push(mesh);
        root.add(mesh);
        const materials: Material[] = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials)
          for (const value of Object.values(material))
            if (value && (value as Texture).isTexture) textures.add(value as Texture);
      });
    };
    const attempt = (label: string, build: () => void) => {
      try {
        build();
      } catch (error) {
        log("warning", `워밍업 건너뜀: ${label}`, error instanceof Error ? error.message : String(error));
      }
    };
    for (const url of MODEL_URLS) {
      const model = scenes[url];
      if (model) addWithInstances(model.clone(true));
    }
    // Play robots use geometry scaled once per source (see Robot.tsx); build and compile it now.
    const robot = scenes[MODEL.robot];
    if (robot)
      attempt("scaled robot", () => {
        const scaled = robot.clone(true);
        scaled.traverse((node) => {
          if (node instanceof Mesh) node.geometry = geometryAtScale(node.geometry, SIMULATOR_CONFIG.robotScale);
        });
        addWithInstances(scaled);
      });
    for (const turn of TURNS) addWithInstances(conveyorTemplate(turn).clone(true));
    for (const kind of GHOSTS) {
      const source = scenes[MODEL[kind]];
      if (!source) continue;
      attempt(`${kind} ghost`, () => {
        const ghost = buildModelGhost(kind, source).model;
        keepAlive.push(ghost);
        root.add(ghost);
      });
    }
    for (const turn of TURNS) {
      const ghost = buildConveyorGhost(turn).model;
      keepAlive.push(ghost);
      root.add(ghost);
    }
    gl.compileAsync(root, camera, scene)
      .then(() => {
        for (const texture of textures) gl.initTexture(texture);
      })
      .catch((error: unknown) => {
        // Warm-up is best effort: the first render compiles anything left over.
        log("warning", "셰이더 워밍업 실패", error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        for (const mesh of instanced) mesh.dispose();
        ready();
      });
  }, [settled, gl, scene, camera]);
  return null;
}
