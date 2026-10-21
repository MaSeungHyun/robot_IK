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
 */
export class SelectionOutline {
  readonly root = new Group();
  private selected: string | null = null;
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
    color: 0x38bdf8,
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
    fragmentShader: `void main(){gl_FragColor=vec4(0.2196,0.7412,0.9725,1.0);}`,
  });
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
  sync(instances: SceneInstances, id: string | null, resolution: Vector2) {
    if (id !== this.selected) {
      this.clear();
      this.selected = id;
    }
    if (!id) return;
    this.material.uniforms.resolution.value.copy(resolution);
    this.root.updateWorldMatrix(true, false);
    this.inverse.copy(this.root.matrixWorld).invert();
    for (const shell of this.shells.values()) shell.visible = false;
    instances.forEachSelected(id, this.add);
    for (const [source, shell] of this.shells)
      if (!shell.visible) {
        if (shell instanceof LineSegments) shell.geometry.dispose();
        shell.removeFromParent();
        this.shells.delete(source);
        this.masks.get(source)?.removeFromParent();
        this.masks.delete(source);
      }
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
