import { Suspense, useEffect, useMemo, useState } from "react";
import { registerRobotPedestal, unregisterRobotPedestal } from "@/domain/layout/robotPedestals";
import { useThree, type RootState } from "@react-three/fiber";
import { Group, HalfFloatType, Mesh, Texture, WebGLRenderTarget, type BufferGeometry, type Camera, type Material, type Object3D, type Scene } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useGLTF } from "@/lib/three/gltfLoader";
import { findGlbNode, stripLights } from "@/lib/three/glbNode";
import { releaseEquipment } from "@/stores/actions/loadTemplate";
import { useSceneStore } from "@/stores/useSceneStore";
import { useTemplateLoadStore } from "@/stores/useTemplateLoadStore";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";
import type { TemplateProp } from "@/types/sceneTemplate";
import DropInGroup from "@/viewport/editor/DropInGroup";
import { dropInSchedule } from "@/viewport/editor/dropIn";
import { groupPropsBySource, propChunk } from "@/viewport/props/propSources";

/** Main-thread budget per frame for cloning props; each chunk's merge runs alone in its frame. */
const FRAME_BUDGET_MS = 8;

/** One prop node cloned at its authored transform (lights stripped, decals depth-offset, pedestal registered). */
function cloneProp(scene: Object3D, url: string, prop: TemplateProp, pedestalKeys: string[]): Object3D | null {
  const name = prop.node;
  const node = findGlbNode(scene, name, true);
  if (!node) { console.warn(`[GlbProps] node "${name}" not found in ${url}; skipped`); return null; }
  const clone = stripLights(node.clone(true));
  clone.userData.glbProp = name;
  if (prop.position) clone.position.set(...prop.position);
  if (prop.yaw !== undefined) clone.rotation.set(0, prop.yaw, 0);
  if (prop.excludeMaterials?.length) {
    const drop: Object3D[] = [];
    clone.traverse((o) => { const name = (o as { material?: { name?: string } }).material?.name; if (name && prop.excludeMaterials!.includes(name)) drop.push(o); });
    drop.forEach((o) => o.removeFromParent());
  }
  clone.traverse((o) => { o.castShadow = true; o.receiveShadow = true; o.raycast = () => {}; });
  clone.updateMatrixWorld(true);
  // Floor decals sit on the floor plane: pull them toward the camera in depth instead of lifting them.
  clone.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    if (name !== "FloorMarking" && !mesh.material.name.startsWith("FloorMarking")) return;
    // Only flat floor paint: Rack_m frames (and Enviroment signage) also use a "FloorMarking" material but stand upright.
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    if (bounds.max.y - bounds.min.y > 0.05 || bounds.max.y > 0.1) return;
    const material = mesh.material.clone();
    Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    mesh.material = material;
    mesh.userData.noCastShadow = true;
    mesh.castShadow = false;
  });
  // [pedestal] robot_base / robot_arm_place: world bbox top -> robots placed on it sit on top.
  const key = registerRobotPedestal(clone, name);
  if (key) pedestalKeys.push(key);
  return clone;
}

const uploaded = new WeakSet<Texture>();
type Renderer = RootState["gl"] & { initTexture?: (t: Texture) => void; compileAsync?: (o: Object3D, c: Camera, s?: Scene) => Promise<unknown> };

/** Uploads the chunk's textures (budgeted per frame) and compiles its programs against the live scene's lights before it shows. */
async function warmUp(roots: Object3D[], gl: Renderer, camera: Camera, scene: Scene, frame: () => Promise<void>, cancelled: () => boolean) {
  const textures = new Set<Texture>();
  for (const root of roots) root.traverse((o) => {
    const material = (o as Mesh).material;
    for (const m of (Array.isArray(material) ? material : material ? [material] : []) as unknown as Record<string, unknown>[])
      for (const v of Object.values(m)) if (v instanceof Texture && !uploaded.has(v)) textures.add(v);
  });
  let t0 = performance.now();
  for (const texture of textures) {
    if (performance.now() - t0 > FRAME_BUDGET_MS) { await frame(); if (cancelled()) return; t0 = performance.now(); }
    uploaded.add(texture);
    gl.initTexture?.(texture);
  }
  if (!gl.compileAsync) return;
  const probe = new Group();
  for (const root of roots) probe.add(root);
  // The composer renders the scene into a linear HalfFloat buffer: compile for that output (not the canvas's sRGB),
  // otherwise these are extra programs the first frame never uses. compileAsync creates the programs synchronously.
  const previous = gl.getRenderTarget();
  const offscreen = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  let pending: Promise<unknown> | null = null;
  try { gl.setRenderTarget(offscreen); pending = gl.compileAsync(probe, camera, scene); } catch { /* compiled lazily on first draw instead */ } finally { gl.setRenderTarget(previous); }
  try { await pending; } catch { /* idem */ }
  offscreen.dispose();
  for (const root of roots) probe.remove(root);
}

type Chunk = { chunk: number; id: string; roots: Object3D[] };

/**
 * Builds the source's props in load-order chunks (structure -> racks -> pallets/props) spread over frames,
 * so the first chunk shows before the rest is cloned/merged. Each chunk reveals with the drop-in effect.
 */
function PropSource({ url, nodes }: { url: string; nodes: readonly TemplateProp[] }) {
  const { scene } = useGLTF(url) as unknown as { scene: Object3D };
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene3 = useThree((state) => state.scene);
  // Chunks built for `owner` (the current nodes list); a new list starts empty without a reset render.
  const [built, setBuilt] = useState<{ owner: readonly TemplateProp[]; list: Chunk[] }>({ owner: nodes, list: [] });
  useEffect(() => {
    const order = new Map<number, TemplateProp[]>();
    for (const prop of nodes) { const c = propChunk(prop); order.set(c, [...(order.get(c) ?? []), prop]); }
    const queue = [...order].sort((a, b) => a[0] - b[0]);
    const pedestalKeys: string[] = [];
    let raf = 0, cancelled = false, started = false, done = false;
    const frame = () => new Promise<void>((resolve) => { raf = requestAnimationFrame(() => resolve()); });
    // Sources without a structure chunk release the equipment once every source is built.
    const finish = () => { done = true; useTemplateLoadStore.getState().sourceDone(); if (!useTemplateLoadStore.getState().pending) releaseEquipment(); };
    void (async () => {
      await frame();
      if (cancelled) return;
      started = true;
      for (const [chunk, list] of queue) {
        // Clone within the per-frame budget.
        const pending: Object3D[] = [];
        let t0 = performance.now();
        for (const prop of list) {
          const clone = cloneProp(scene, url, prop, pedestalKeys);
          if (clone) pending.push(clone);
          if (performance.now() - t0 > FRAME_BUDGET_MS) { await frame(); if (cancelled) return; t0 = performance.now(); }
        }
        await frame();
        if (cancelled) return;
        const roots = mergeStatic(pending); // once per chunk, alone in its frame
        // GPU warm-up before the reveal: textures uploaded one per frame budget, programs compiled (parallel when supported).
        await warmUp(roots, gl, camera, scene3, frame, () => cancelled);
        if (cancelled) return;
        const id = `prop:${url}:${chunk}`;
        const load = useTemplateLoadStore.getState();
        if (load.active && useViewportSettingsStore.getState().loadAnimation) {
          // Racks/pallets wait for their equipment stage; structure shows at once.
          dropInSchedule.set(id, Math.max(performance.now(), load.stageAt[chunk] ?? 0));
        }
        setBuilt((prev) => ({ owner: nodes, list: [...(prev.owner === nodes ? prev.list : []), { chunk, id, roots }] }));
        if (load.active) { load.visible(); load.setStage(Math.min(chunk, 1)); }
        if (chunk <= 1) releaseEquipment();
        await frame();
        if (cancelled) return;
      }
      finish();
    })();
    return () => { cancelled = true; if (started && !done) finish(); cancelAnimationFrame(raf); pedestalKeys.forEach(unregisterRobotPedestal); };
  }, [scene, url, nodes, gl, camera, scene3]);
  const chunks = built.owner === nodes ? built.list : [];
  return <>{chunks.map(({ id, roots }) => <DropInGroup key={id} id={id}>{roots.map((clone) => <primitive key={clone.uuid} object={clone} />)}</DropInGroup>)}</>;
}

/**
 * Props never move, so their meshes are baked to world space and merged per material + attribute layout:
 * one draw call per material instead of one per mesh, in the main pass and in every shadow pass.
 * Geometry and materials are unchanged (same look, native scale); skinned/multi-material meshes stay as they are.
 */
function mergeStatic(roots: Object3D[]): Object3D[] {
  const buckets = new Map<string, { material: Material; geometries: BufferGeometry[] }>();
  const keep: Object3D[] = [];
  for (const root of roots) {
    root.updateMatrixWorld(true);
    const drop: Mesh[] = [];
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || (mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh || (mesh as { isInstancedMesh?: boolean }).isInstancedMesh || Array.isArray(mesh.material) || mesh.morphTargetInfluences || mesh.matrixWorld.determinant() < 0) return; // mirrored meshes keep three's front-face flip
      const g = mesh.geometry;
      const key = [mesh.material.uuid, g.index ? "i" : "n", ...Object.keys(g.attributes).sort().map((k) => k + g.attributes[k].itemSize + g.attributes[k].array.constructor.name + (g.attributes[k].normalized ? "n" : ""))].join("|"); // mergeGeometries needs one array type per attribute
      const geometry = g.clone().applyMatrix4(mesh.matrixWorld);
      geometry.morphAttributes = {};
      const bucket = buckets.get(key) ?? { material: mesh.material, geometries: [] };
      bucket.geometries.push(geometry);
      buckets.set(key, bucket);
      drop.push(mesh);
    });
    drop.forEach((mesh) => mesh.removeFromParent());
    let left = false;
    root.traverse((o) => { if (o !== root && ((o as Mesh).isMesh || (o as { isLight?: boolean }).isLight)) left = true; });
    if (left) keep.push(root);
  }
  const merged = new Group();
  merged.name = "GlbPropsMerged";
  for (const { material, geometries } of buckets.values()) {
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (!geometry) { console.warn(`[GlbProps] merge failed for material "${material.name}"; meshes kept unmerged`); geometries.forEach((g) => merged.add(Object.assign(new Mesh(g, material), { castShadow: true, receiveShadow: true, raycast: () => {} }))); continue; }
    geometries.forEach((g) => g !== geometry && g.dispose());
    const mesh = new Mesh(geometry, material);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // Flat on the floor (decals, walkways): receives shadows but cannot cast a visible one.
    if (box.max.y - box.min.y < 0.05 && box.max.y < 0.1) mesh.userData.noCastShadow = true;
    mesh.castShadow = !mesh.userData.noCastShadow;
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    merged.add(mesh);
  }
  const all = [...keep, merged];
  for (const root of all) root.traverse((o) => { o.updateMatrix(); o.updateMatrixWorld(true); o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; });
  merged.userData.glbProp = "merged";
  return all;
}

/** Static decor from the loaded template's `props`, drawn at their authored GLB transforms (not simulated, not pickable). */
export default function GlbProps() {
  const props = useSceneStore((state) => state.props);
  const groups = useMemo(() => groupPropsBySource(props), [props]);
  if (!groups.length) return null;
  return <Suspense fallback={null}>{groups.map(([url, nodes]) => <PropSource key={url} url={url} nodes={nodes} />)}</Suspense>;
}