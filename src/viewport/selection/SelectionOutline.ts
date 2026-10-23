import {
  AlwaysStencilFunc,
  BackSide,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  ShaderMaterial,
  Color,
  type ColorRepresentation,
  InstancedMesh,
  Vector2,
} from "three";
import type { SceneInstances } from "@/viewport/instancing/SceneInstances";

/**
 * Selection outline width for the inverted-hull shells (was 5). The hull is pushed out by
 * OUTLINE_WIDTH_PX / 2 drawing-buffer pixels per side (×DPR of CSS px). Flat meshes use 1px edge lines.
 */
export const OUTLINE_WIDTH_PX = 8;

/** Stencil value marking the selected silhouette. */
const SILHOUETTE = 1;
/** Drawn after the scene: silhouette mask first, then the hull outside it. */
const MASK_ORDER = 9998,
  HULL_ORDER = 9999;

/**
 * Reuses selected source geometry; the normal scene remains instanced.
 * Stencil outline: the selection is written to the stencil buffer (no colour/depth), then the
 * expanded back-face hull is drawn without depth test only where the stencil is not set, so the
 * outline ring stays visible through objects that overlap or occlude the selection.
 * Requires a stencil buffer on the canvas and the post-processing composer.
 * Several instances (e.g. selection + linked equipment) share the stencil value, so one outline never
 * paints over another outlined silhouette (all masks render before all hulls).
 */
export class SelectionOutline {
  readonly root = new Group();
  private selected: string | null = null;
  /** Non-instanced meshes of the selection (scanner, door, AMR lamps, skinned parts), re-collected periodically. */
  private direct: Mesh[] = [];
  private directAge = 0;
  private inverse = new Matrix4();
  private shells = new Map<Mesh, Mesh | LineSegments>();
  private masks = new Map<Mesh, Mesh>();
  private mask = new MeshBasicMaterial({
    side: DoubleSide,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    stencilWrite: true,
    stencilRef: SILHOUETTE,
    stencilFunc: AlwaysStencilFunc,
    stencilZPass: ReplaceStencilOp,
  });
  private lines = new LineBasicMaterial({
    depthWrite: false,
    toneMapped: false,
  });
  private material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    stencilWrite: true,
    stencilRef: SILHOUETTE,
    stencilFunc: NotEqualStencilFunc,
    toneMapped: false,
    uniforms: {
      resolution: { value: new Vector2(1, 1) },
      width: { value: OUTLINE_WIDTH_PX },
      color: { value: new Color() },
    },
    vertexShader: `
      uniform vec2 resolution;
      uniform float width;
      void main(){
        vec4 viewPosition=modelViewMatrix*vec4(position,1.0);
        vec3 viewNormal=normalize(normalMatrix*normal);
        vec4 projectedNormal=projectionMatrix*vec4(viewNormal,0.0);
        vec4 clip=projectionMatrix*viewPosition;
        vec2 direction=projectedNormal.xy;
        float lengthSquared=dot(direction,direction);
        if(lengthSquared>0.000001)clip.xy+=direction*inversesqrt(lengthSquared)*width/resolution*clip.w;
        gl_Position=clip;
      }`,
    fragmentShader: `uniform vec3 color;void main(){gl_FragColor=vec4(color,1.0);}`,
  });
  /** `color`: outline colour (default: selection sky). Kept in sRGB like the former hardcoded value. */
  constructor(color: ColorRepresentation = 0x38bdf8) {
    this.lines.color.set(color);
    (this.material.uniforms.color.value as Color).set(color).convertLinearToSRGB();
  }
  private add = (source: Mesh) => {
    let shell = this.shells.get(source);
    if (!shell) {
      if (!source.geometry.boundingBox) source.geometry.computeBoundingBox();
      const bounds = source.geometry.boundingBox!;
      const flat =
        Math.min(
          bounds.max.x - bounds.min.x,
          bounds.max.y - bounds.min.y,
          bounds.max.z - bounds.min.z,
        ) < 1e-7;
      shell = flat
        ? new LineSegments(new EdgesGeometry(source.geometry), this.lines)
        : new Mesh(source.geometry, this.material);
      shell.matrixAutoUpdate = false;
      shell.frustumCulled = false;
      shell.raycast = () => {};
      shell.renderOrder = HULL_ORDER;
      this.shells.set(source, shell);
      this.root.add(shell);
      if (!flat) {
        const mask = new Mesh(source.geometry, this.mask);
        mask.matrixAutoUpdate = false;
        mask.frustumCulled = false;
        mask.raycast = () => {};
        mask.renderOrder = MASK_ORDER;
        this.masks.set(source, mask);
        this.root.add(mask);
      }
    }
    shell.visible = true;
    shell.matrix.multiplyMatrices(this.inverse, source.matrixWorld);
    this.masks.get(source)?.matrix.copy(shell.matrix);
  };
  /** `ids`: every selected scene object / box (multi-select outlines all of them). */
  sync(instances: SceneInstances, ids: readonly string[], resolution: Vector2) {
    const key = ids.length ? ids.join("|") : null;
    if (key !== this.selected) {
      this.clear();
      this.selected = key;
      this.directAge = Infinity;
    }
    if (!key) return;
    this.material.uniforms.resolution.value.copy(resolution);
    this.root.updateWorldMatrix(true, false);
    this.inverse.copy(this.root.matrixWorld).invert();
    for (const shell of this.shells.values()) shell.visible = false;
    for (const id of ids) instances.forEachSelected(id, this.add);
    // Equipment that is not instanced at all (scanner, door) or partly (AMR lamps, skinned meshes).
    if (++this.directAge > 30) this.collectDirect(ids);
    for (const mesh of this.direct) if (mesh.visible && mesh.parent) this.add(mesh);
    for (const [source, shell] of this.shells)
      if (!shell.visible) {
        if (shell instanceof LineSegments) shell.geometry.dispose();
        shell.removeFromParent();
        this.shells.delete(source);
        this.masks.get(source)?.removeFromParent();
        this.masks.delete(source);
      }
  }
  /**
   * Real (non-instanced) meshes under each selected `userData.sceneId` group. Instanced sources are
   * hidden (visible=false) and skipped; helper overlays tagged `userData.noOutline` and transparent
   * meshes (range discs, beams) are skipped; nested objects with another sceneId are not descended.
   */
  private collectDirect(ids: readonly string[]) {
    this.directAge = 0;
    this.direct = [];
    let top = this.root as import("three").Object3D;
    while (top.parent) top = top.parent;
    const wanted = new Set(ids);
    const collect = (node: import("three").Object3D, id: string) => {
      if (!node.visible || node.userData.noOutline) return;
      if (node.userData.sceneId && node.userData.sceneId !== id) return;
      if (node instanceof Mesh && !(node instanceof InstancedMesh)) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        if (!materials.some((m) => m.transparent && m.opacity < 1)) this.direct.push(node);
      }
      for (const child of node.children) collect(child, id);
    };
    const find = (node: import("three").Object3D) => {
      if (node === this.root) return;
      const id = node.userData.sceneId as string | undefined;
      if (id && wanted.has(id) && !node.userData.cargo) { collect(node, id); return; }
      for (const child of node.children) find(child);
    };
    find(top);
  }
  private clear() {
    for (const shell of this.shells.values())
      if (shell instanceof LineSegments) shell.geometry.dispose();
    this.root.clear();
    this.shells.clear();
    this.masks.clear();
  }
  dispose() {
    this.clear();
    this.material.dispose();
    this.mask.dispose();
    this.lines.dispose();
  }
}
