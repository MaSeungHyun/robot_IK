import { useThree } from "@react-three/fiber";
import { usePostWarmup } from "@/viewport/postWarmupState";
import { Suspense, useEffect } from "react";
import PropWarmup from "@/viewport/props/PropWarmup";
import { propsWarmed } from "@/viewport/props/propWarmupState";
import { warmFactoryPrograms } from "@/viewport/lighting/factoryWarmup";
import { Group, InstancedMesh, Material, Mesh, type Object3D, type Texture, type WebGLRenderer } from "three";
import { conveyorTemplate } from "@/objects/conveyor/conveyorTemplate";
import { log } from "@/stores/useLogStore";
import { useModelStore } from "@/stores/useModelStore";
import { useWarmupStore } from "@/stores/useWarmupStore";
import { isWebGPURenderer } from "@/viewport/renderer/createRenderer";
import { instancedDepthMaterial, usesSharedDepth } from "@/viewport/instancing/SceneInstances";
import { buildConveyorGhost, buildModelGhost, type GhostModelKind } from "@/viewport/editor/ghostModels";
import { useModelsSettled } from "@/stores/useModelStore";
import { MODEL, MODEL_URLS } from "@/viewport/models/modelUrls";
import type { ConveyorTurn } from "@/types/layout";

const TURNS: ConveyorTurn[] = ["straight", "left", "right"];
const GHOSTS: GhostModelKind[] = ["robot", "pallet", "amr", "scanner", "rack", "forklift"];
/**
 * Ghost previews built at warm-up are kept alive (never disposed) so their compiled shader
 * programs stay cached; placement ghosts created later reuse them and show on the first drag.
 */
const keepAlive: Object3D[] = [];
/** Post-processing materials from the startup warm-up, never disposed (keeps their programs cached). */
const keptPostMaterials: Material[] = [];
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
        if (usesSharedDepth(node.material)) mesh.customDepthMaterial = instancedDepthMaterial;
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
    for (const turn of TURNS) addWithInstances(conveyorTemplate(turn, scenes[MODEL.rail] ?? undefined).clone(true));
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
      const ghost = buildConveyorGhost(turn, scenes[MODEL.rail] ?? undefined).model;
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
        // Then the same programs for the factory lighting (and the template prop GLBs), so switching to it later does
        // not recompile. The startup screen waits for this (bounded so a missing file never blocks the app).
        const factoryWarm = propsWarmed
          .then(() => (isWebGPURenderer(gl) ? null : warmFactoryPrograms(gl, camera, scene, root)))
          .then((summary) => { if (summary) console.info("[warmup] factory lighting", summary); })
          .then(() => (isWebGPURenderer(gl) ? null : warmPostProcessing(gl as WebGLRenderer)))
          .catch((error: unknown) => log("warning", "공장 조명 워밍업 실패", error instanceof Error ? error.message : String(error)));
        void Promise.race([factoryWarm, new Promise((resolve) => setTimeout(resolve, 120_000))]).then(() => {
          for (const mesh of instanced) mesh.dispose();
          ready();
        });
      });
  }, [settled, gl, scene, camera]);
  return <Suspense fallback={null}><PropWarmup /></Suspense>;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Mounts the factory effect chain (selective bloom + AgX) for a few frames so the composer compiles its programs.
 * Unmounting would dispose those pass materials, and three then drops the programs and their shader-cache ids (a
 * later material gets a new id, so a new cache key): the warm materials are kept undisposed instead (a handful).
 */
async function warmPostProcessing(gl: WebGLRenderer) {
  const before = new Set(gl.info.programs ?? []);
  usePostWarmup.setState({ active: true });
  for (let i = 0; i < 4; i++) await nextFrame();
  const added = new Set((gl.info.programs ?? []).filter((p) => !before.has(p)));
  const dispose = Material.prototype.dispose;
  const kept: Material[] = [];
  Material.prototype.dispose = function (this: Material) {
    const program = (gl.properties.get(this) as { currentProgram?: unknown }).currentProgram;
    if (program && added.has(program as never)) kept.push(this);
    else dispose.call(this);
  };
  try {
    usePostWarmup.setState({ active: false });
    await nextFrame();
    await nextFrame();
  } finally {
    Material.prototype.dispose = dispose;
  }
  keptPostMaterials.push(...kept);
  console.info("[warmup] post-processing", { programs: added.size, keptMaterials: kept.length });
}
