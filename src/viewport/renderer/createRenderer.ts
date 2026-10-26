import { WebGLRenderer, type Material } from "three";
import type { GLProps } from "@react-three/fiber";

type DefaultGLProps = Parameters<Extract<GLProps, (props: never) => unknown>>[0];
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";

export const WEBGPU_FALLBACK_NOTICE = "WebGPU를 사용할 수 없어 WebGL로 실행 중";

type AnyRenderer = { isWebGPURenderer?: boolean; backend?: { isWebGPUBackend?: boolean } };

/** True for three's WebGPURenderer (three/webgpu); the app's WebGL-only paths check this. */
export function isWebGPURenderer(gl: unknown): boolean {
  return (gl as AnyRenderer | null)?.isWebGPURenderer === true;
}

/** The WebGL renderer the app always used: no canvas MSAA (the EffectComposer multisamples), stencil for the outline. */
function webGLRenderer(props: DefaultGLProps) {
  return new WebGLRenderer({ ...props, antialias: false, stencil: true });
}

function fallBack(props: DefaultGLProps, reason: string) {
  console.warn(`[renderer] ${reason}`);
  useViewportSettingsStore.getState().setActiveRenderer("webgl", WEBGPU_FALLBACK_NOTICE);
  return webGLRenderer(props);
}

/**
 * R3F async `gl` factory. WebGL unless the user turned WebGPU on; WebGPU falls back to WebGL when
 * navigator.gpu or an adapter is missing (checked before the canvas gets a context), or when init fails.
 */
export async function createRenderer(props: DefaultGLProps, wantWebGPU: boolean) {
  const store = useViewportSettingsStore.getState();
  if (!wantWebGPU) {
    store.setActiveRenderer("webgl", null);
    return webGLRenderer(props);
  }
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return fallBack(props, "navigator.gpu 없음");
  try {
    if (!(await gpu.requestAdapter())) return fallBack(props, "GPU adapter 없음");
  } catch (error) {
    return fallBack(props, `requestAdapter 실패: ${String(error)}`);
  }
  try {
    const webgpu = await import("three/webgpu");
    const renderer = new webgpu.WebGPURenderer({
      canvas: props.canvas as HTMLCanvasElement,
      powerPreference: props.powerPreference === "default" ? undefined : props.powerPreference,
      alpha: props.alpha,
      // No post-processing composer under WebGPU, so the canvas multisamples itself.
      antialias: true,
      stencil: true,
    });
    await renderer.init();
    if (!(renderer as unknown as AnyRenderer).backend?.isWebGPUBackend) {
      // three silently chose its WebGL2 backend (no WebGPU device): treat it as a failed init.
      await renderer.dispose();
      throw new Error("WebGL2 backend 선택됨");
    }
    const { nodeFallbackFor } = await import("./nodeFallbacks");
    installMaterialFallbacks(renderer, webgpu, nodeFallbackFor);
    store.setActiveRenderer("webgpu", null);
    return renderer;
  } catch (error) {
    // The canvas may now hold a WebGPU context, so remount the Canvas as WebGL on a fresh element.
    console.warn("[renderer] WebGPU init 실패", error);
    store.setActiveRenderer("webgl", WEBGPU_FALLBACK_NOTICE);
    store.setWebGPUFailed(true);
    return webGLRenderer({ ...props, canvas: document.createElement("canvas") });
  }
}

type WebGPUModule = typeof import("three/webgpu");
type LineLike = Material & {
  isLineMaterial?: boolean; color?: { getHex(): number }; linewidth?: number; worldUnits?: boolean;
  dashed?: boolean; dashScale?: number; dashSize?: number; gapSize?: number; vertexColors?: boolean;
};

/**
 * WebGPURenderer only renders built-in and node materials; a GLSL ShaderMaterial logs
 * "Material is not compatible" and draws as a default white material. Map them instead:
 * three-stdlib/drei LineMaterial (Line, Edges) -> Line2NodeMaterial, any other ShaderMaterial
 * (drei Grid, link-flow ribbons, drop-in, selection outline hull) -> an invisible material.
 */
function installMaterialFallbacks(
  renderer: InstanceType<WebGPUModule["WebGPURenderer"]>,
  webgpu: WebGPUModule,
  nodeFallbackFor: (material: Material) => Material | null,
) {
  const library = renderer.library as unknown as { fromMaterial(material: Material): Material | null };
  const fromMaterial = library.fromMaterial.bind(library);
  const cache = new WeakMap<Material, Material>();
  library.fromMaterial = (material) => {
    const converted = fromMaterial(material);
    if (converted) return converted;
    let fallback = cache.get(material);
    if (!fallback) cache.set(material, (fallback = substitute(material)));
    return fallback;
  };
  const substitute = (material: Material): Material => {
    const line = material as LineLike;
    if (line.isLineMaterial) {
      const node = new webgpu.Line2NodeMaterial({
        color: line.color?.getHex(),
        linewidth: line.linewidth,
        worldUnits: line.worldUnits,
        dashed: line.dashed,
        dashSize: line.dashSize,
        gapSize: line.gapSize,
        vertexColors: line.vertexColors,
      });
      node.transparent = line.transparent;
      node.opacity = line.opacity;
      node.depthTest = line.depthTest;
      node.depthWrite = line.depthWrite;
      node.toneMapped = line.toneMapped;
      return node;
    }
    // Ported GLSL materials (link flow, selection hull, drop-in); anything else stays invisible.
    return nodeFallbackFor(material) ?? new webgpu.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
  };
}