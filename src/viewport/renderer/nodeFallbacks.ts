import { Color, Vector2, type Material, type ShaderMaterial } from "three";
import { MeshBasicNodeMaterial, type NodeFrame } from "three/webgpu";
import {
  abs, cameraPosition, cameraProjectionMatrix, clamp, dot, exp, float, fract, Fn, inverseSqrt, max, mix, normalize,
  modelViewMatrix, normalLocal, normalWorld, positionLocal, positionWorld, transformNormalToView, pow, select, smoothstep, step, uniform, uv, vec2, vec3, vec4,
} from "three/tsl";
import { AUTO_LAYOUT_DROP_IN as DROP_IN } from "@/constants/auto-layout";

/**
 * TSL ports of the app's GLSL ShaderMaterials (WebGPU only; this module is loaded with three/webgpu).
 * The original ShaderMaterial stays on the mesh: the pipeline state (blending, side, depth, stencil,
 * transparent, render order) comes from it, and every uniform is read from its `uniforms` per object,
 * so code that writes `material.uniforms.x.value` keeps working unchanged under both renderers.
 * Tag a ShaderMaterial with `userData.webgpuNode = "<kind>"` to use one of these.
 */
export type NodeFallbackKind = "linkFlow" | "outlineHull" | "dropIn";

/** A uniform that mirrors `material.uniforms[name].value` of the ShaderMaterial being drawn. */
function mirrored<T extends number | Color>(name: string, initial: T) {
  return uniform(initial as never).onObjectUpdate((frame: NodeFrame) => {
    const value = (frame.material as ShaderMaterial | null)?.uniforms?.[name]?.value as T | undefined;
    return value as never;
  });
}

function base() {
  // ShaderMaterial output is raw (no tone mapping), like the GLSL versions.
  const material = new MeshBasicNodeMaterial();
  material.toneMapped = false;
  material.fog = false;
  return material;
}

/** linkFlow.ts: glowing flow ribbon with streaks (same formulas as the GLSL). */
function linkFlow() {
  const time = mirrored("time", 0), color = mirrored("color", new Color()), opacity = mirrored("opacity", 0.75);
  const length = mirrored("length", 1), emphasis = mirrored("emphasis", 0);
  const material = base();
  const across = abs(uv().y.mul(2).sub(1));
  const core = float(1).sub(smoothstep(emphasis.mul(0.06).add(0.08), emphasis.mul(0.08).add(0.2), across));
  const glow = exp(across.mul(across).mul(-7)).mul(0.45);
  const phase = fract(uv().x.mul(length).div(0.9).sub(time.mul(emphasis.mul(0.8).add(1.2)).div(0.9)));
  const streak = smoothstep(0, 0.75, phase).mul(float(1).sub(smoothstep(0.75, 0.82, phase)));
  const ends = smoothstep(0, 0.04, uv().x).mul(float(1).sub(smoothstep(0.96, 1, uv().x)));
  const alpha = clamp(core.mul(0.95).add(glow.mul(0.9)).add(streak.mul(core.add(glow.mul(0.8)))), 0, 1).mul(ends).mul(opacity);
  const rgb = mix(vec3(color).mul(0.55), vec3(color), core).add(vec3(1).mul(streak).mul(core).mul(0.6));
  material.colorNode = rgb;
  material.opacityNode = alpha;
  return material;
}

/** SelectionOutline.ts: back-face hull pushed out by `width` drawing-buffer pixels in clip space. */
function outlineHull() {
  const resolution = uniform(new Vector2(1, 1)).onObjectUpdate((frame: NodeFrame) =>
    (frame.material as ShaderMaterial | null)?.uniforms?.resolution?.value);
  const width = mirrored("width", 8), color = mirrored("color", new Color());
  const material = base();
  material.vertexNode = Fn(() => {
    const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(positionLocal, 1))).toVar();
    const direction = cameraProjectionMatrix.mul(vec4(normalize(transformNormalToView(normalLocal)), 0)).xy;
    const lengthSquared = dot(direction, direction);
    const offset = select(lengthSquared.greaterThan(0.000001),
      direction.mul(inverseSqrt(lengthSquared)).mul(width).div(resolution).mul(clip.w), vec2(0, 0));
    return vec4(clip.xy.add(offset), clip.z, clip.w);
  })();
  material.colorNode = vec3(color);
  return material;
}

/** dropIn.ts: additive hologram with rim, scan lines and the reveal band. */
function dropIn() {
  const H = DROP_IN.hologram;
  const uColor = mirrored("uColor", new Color()), uMinY = mirrored("uMinY", 0), uHeight = mirrored("uHeight", 1);
  const uBand = mirrored("uBand", -1), uFlash = mirrored("uFlash", 0), uFade = mirrored("uFade", 1);
  const material = base();
  const view = normalize(cameraPosition.sub(positionWorld));
  const rim = pow(float(1).sub(abs(dot(normalize(normalWorld), view))), H.rimPower);
  const scan = step(0.5, fract(positionWorld.y.mul(H.scanDensity))).mul(H.scan);
  const h = positionWorld.y.sub(uMinY).div(max(uHeight, 1e-3));
  const band = select(uBand.lessThan(0), float(0), smoothstep(H.bandWidth, 0, abs(h.sub(uBand))));
  const a = float(H.opacity).add(rim.mul(H.rim)).add(scan).mul(uFade).add(band.mul(H.band)).add(uFlash.mul(H.flash));
  material.colorNode = mix(vec3(uColor), vec3(1), clamp(band.mul(0.5).add(uFlash.mul(0.6)), 0, 1)).mul(a);
  return material;
}

const FACTORIES: Record<NodeFallbackKind, () => Material> = { linkFlow, outlineHull, dropIn };

/** Node material for a tagged ShaderMaterial, or null when it has no port. */
export function nodeFallbackFor(material: Material): Material | null {
  const kind = material.userData.webgpuNode as NodeFallbackKind | undefined;
  if (!kind || !(kind in FACTORIES)) return null;
  // three only re-uploads per-object uniforms when the observer sees a node on the *drawn* material
  // (the ShaderMaterial); without one, `uniforms.x.value` writes would never reach the GPU once the
  // object stops moving. Any node property switches it to a full refresh every frame. WebGL ignores it.
  (material as Material & { webgpuRefreshNode?: unknown }).webgpuRefreshNode = float(0);
  return FACTORIES[kind]();
}