import { Suspense, useMemo } from "react";
import { Group, Mesh, type BufferGeometry, type Material, type Object3D } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useGLTF } from "@/lib/three/gltfLoader";
import { findGlbNode, stripLights } from "@/lib/three/glbNode";
import { useSceneStore } from "@/stores/useSceneStore";
import type { TemplateProp } from "@/types/sceneTemplate";
import factoryGlbUrl from "@/constants/templates/factory.glb?url";

// rail_in_out.glb (입하/출하 rail) lives only in the optimized set; resolve optionally so models_original builds still work.
const railInOutUrl = Object.entries(import.meta.glob<string>("/src/assets/models/rail_in_out.glb", { query: "?url", import: "default", eager: true }))[0]?.[1];
// AGV.glb: root node "AGV" (pivot = vehicle centre, y 0.208 like factory.glb, scale 1, 1.08 × 1.19 m footprint).
const agvUrl = Object.entries(import.meta.glob<string>("/src/assets/models/AGV.glb", { query: "?url", import: "default", eager: true }))[0]?.[1];

/** Template prop sources (lazy: the 34 MB factory.glb only loads when a template lists props). */
const SOURCES: Partial<Record<TemplateProp["source"], string>> = { factory: factoryGlbUrl, railInOut: railInOutUrl, agv: agvUrl };

function PropSource({ url, nodes }: { url: string; nodes: readonly TemplateProp[] }) {
  const { scene } = useGLTF(url) as unknown as { scene: Object3D };
  const clones = useMemo(() => {
    const out: Object3D[] = [];
    for (const prop of nodes) {
      const name = prop.node;
      const node = findGlbNode(scene, name, true);
      if (!node) { console.warn(`[GlbProps] node "${name}" not found in ${url}; skipped`); continue; }
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
      // Floor decals sit on the floor plane: pull them toward the camera in depth instead of lifting them.
      clone.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        if (name !== "FloorMarking" && !mesh.material.name.startsWith("FloorMarking")) return;
        const material = mesh.material.clone();
        Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
        mesh.material = material;
        mesh.userData.noCastShadow = true;
        mesh.castShadow = false;
      });
      out.push(clone);
    }
    return mergeStatic(out);
  }, [scene, url, nodes]);
  return <>{clones.map((clone) => <primitive key={clone.uuid} object={clone} />)}</>;
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
      const key = [mesh.material.uuid, g.index ? "i" : "n", ...Object.keys(g.attributes).sort().map((k) => k + g.attributes[k].itemSize)].join("|");
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
    if (!geometry) continue;
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
  const groups = useMemo(() => {
    const map = new Map<string, TemplateProp[]>();
    for (const p of props) { const url = SOURCES[p.source]; if (url) map.set(url, [...(map.get(url) ?? []), p]); else console.warn(`[GlbProps] source "${p.source}" unavailable; ${p.node} skipped`); }
    return [...map];
  }, [props]);
  if (!groups.length) return null;
  return <Suspense fallback={null}>{groups.map(([url, nodes]) => <PropSource key={url} url={url} nodes={nodes} />)}</Suspense>;
}