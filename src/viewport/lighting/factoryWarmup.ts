import { BackSide, BoxGeometry, DoubleSide, FrontSide, Group, HalfFloatType, InstancedMesh, Mesh, MeshDepthMaterial, PCFShadowMap, RGBADepthPacking, Scene, WebGLRenderTarget, type Camera, type Light, type Material, type Object3D, type Texture, type WebGLRenderer } from "three";
import { selectShadowQuality, useViewportSettingsStore } from "@/stores/useViewportSettingsStore";
import { dropInMaterial } from "@/viewport/editor/dropIn";
import { applyShadowQuality, buildFactoryLights } from "@/viewport/lighting/factoryLights";
import { loadEnvironment } from "@/viewport/lighting/sceneEnvironmentConfig";
import { PROP_SOURCES } from "@/viewport/props/propSources";
import { propScenes } from "@/viewport/props/propWarmupState";

/**
 * Startup compile with the factory lighting's exact program inputs: the factory.glb light rig (same count, types and
 * shadow casters as FactoryLighting at the current shadow quality), PCF shadows, the HDR environment and an offscreen
 * target like the EffectComposer's (linear output). Loading the factory template then reuses every program instead of
 * recompiling all materials when the lights change. Covers the given warm-up root (equipment, instanced, ghosts), the
 * template prop GLBs, the drop-in hologram and the live scene's own meshes (floor, grid, lines). Textures of the prop
 * GLBs are uploaded too. Returns a summary for the log.
 */
const SHADOW_SIDE = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide } as const;
const depthKeep: MeshDepthMaterial[] = [];

/**
 * Stand-ins for the shadow pass: one mesh per distinct depth-program variant, with the MeshDepthMaterial setup
 * WebGLShadowMap.getDepthMaterial derives from the real material (side, alpha-tested map, displacement, instancing).
 * Compiled with the factory lights, the first shadow render reuses these programs. Materials are kept alive.
 */
function shadowDepthRoot(sources: Object3D[]) {
  const root = new Group();
  const seen = new Set<string>();
  for (const source of sources) source.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || (mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as (Material & { map?: Texture | null; alphaMap?: Texture | null; displacementMap?: Texture | null; displacementScale?: number; wireframe?: boolean })[]) {
      const alphaTest = m.alphaToCoverage ? 0.5 : m.alphaTest;
      const textured = alphaTest > 0 && !!(m.map || m.alphaMap);
      const displaced = !!m.displacementMap && m.displacementScale !== 0;
      const side = m.shadowSide ?? SHADOW_SIDE[m.side];
      const instanced = !!(mesh as { isInstancedMesh?: boolean }).isInstancedMesh;
      const morph = Object.keys(mesh.geometry.morphAttributes).join("/");
      const key = [side, textured && !!m.map, textured && !!m.alphaMap, alphaTest > 0, displaced, instanced, morph, m.wireframe].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const depth = new MeshDepthMaterial();
      Object.assign(depth, { side, alphaTest, wireframe: !!m.wireframe, map: m.map ?? null, alphaMap: m.alphaMap ?? null, displacementMap: m.displacementMap ?? null, displacementScale: m.displacementScale ?? 1 });
      depthKeep.push(depth);
      root.add(instanced ? new InstancedMesh(mesh.geometry, depth, 1) : new Mesh(mesh.geometry, depth));
      // Selective bloom's depth pass draws the same geometry with an RGBA-packed override depth material.
      const override = `${instanced}|${morph}|override`;
      if (seen.has(override)) continue;
      seen.add(override);
      const packed = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
      depthKeep.push(packed);
      root.add(instanced ? new InstancedMesh(mesh.geometry, packed, 1) : new Mesh(mesh.geometry, packed));
    }
  });
  return root;
}

export async function warmFactoryPrograms(gl: WebGLRenderer, camera: Camera, live: Scene, warmRoot: Object3D) {
  const factory = PROP_SOURCES.factory && propScenes.get(PROP_SOURCES.factory);
  if (!factory) return null;
  const lights = buildFactoryLights(factory);
  applyShadowQuality(lights, selectShadowQuality(useViewportSettingsStore.getState()));
  const target = new Scene();
  for (const light of lights) target.add(light, light.target);
  target.updateMatrixWorld(true);
  target.environment = await loadEnvironment();

  const root = new Group();
  const textures = new Set<Texture>();
  for (const source of propScenes.values()) {
    root.add(source.clone(true));
    source.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      for (const material of (Array.isArray(node.material) ? node.material : [node.material]) as Material[])
        for (const value of Object.values(material)) if (value && (value as Texture).isTexture) textures.add(value as Texture);
    });
  }
  const probe = new BoxGeometry();
  root.add(new Mesh(probe, dropInMaterial));

  // compile() also gathers lights from the compiled object: hide the live scene's own (default-mode) lights meanwhile.
  const hidden: Light[] = [];
  live.traverse((o) => { if ((o as Light).isLight && o.visible) { hidden.push(o as Light); o.visible = false; } });
  const previousType = gl.shadowMap.type;
  const previousTarget = gl.getRenderTarget();
  const offscreen = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  gl.shadowMap.type = PCFShadowMap;
  const depthRoot = shadowDepthRoot([warmRoot, root, live]);
  gl.setRenderTarget(offscreen);
  let pending: Promise<unknown>[];
  try {
    // compileAsync creates every program synchronously, so the state above only has to hold for these calls.
    pending = [gl.compileAsync(warmRoot, camera, target), gl.compileAsync(root, camera, target), gl.compileAsync(live, camera, target)];
    // Shadow pass depth programs (compile only, no offscreen shadow render: that broke context creation before).
    // The shadow / depth passes render without scene lights: compile against an empty scene.
    pending.push(gl.compileAsync(depthRoot, camera, new Scene()));
  } finally {
    gl.setRenderTarget(previousTarget);
    gl.shadowMap.type = previousType;
    for (const light of hidden) light.visible = true;
  }
  // Template apply's first frames still run under the default rig (ambient + shadow-casting sun): compile for it too.
  gl.setRenderTarget(offscreen);
  try { pending.push(gl.compileAsync(depthRoot, camera, live)); } finally { gl.setRenderTarget(previousTarget); }
  await Promise.all(pending);
  for (const texture of textures) gl.initTexture(texture);
  offscreen.dispose();
  probe.dispose();
  return {
    lights: lights.length,
    spot: lights.filter((l) => (l as { isSpotLight?: boolean }).isSpotLight).length,
    directional: lights.filter((l) => (l as { isDirectionalLight?: boolean }).isDirectionalLight).length,
    shadows: lights.filter((l) => l.castShadow).length,
    textures: textures.size,
    depthVariants: depthRoot.children.length,
  };
}