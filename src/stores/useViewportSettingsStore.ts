import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { RENDER_QUALITY, type RenderQuality } from "@/constants/viewport";
import { createCookieStorage } from "@/lib/storage/cookieStorage";

export type ShadowQuality = "off" | "low" | "high";

const SHADOW_QUALITIES: readonly ShadowQuality[] = ["off", "low", "high"];

/** User preferences only (no scene/layout data); persisted in a cookie. */
interface ViewportSettings {
  renderQuality: RenderQuality;
  bloomEnabled: boolean;
  shadowQuality: ShadowQuality;
  /** Dev-only r3f-perf overlay (Shift+P). */
  perfOverlay: boolean;
  /** Perf bar expanded into trend graphs. */
  perfExpanded: boolean;
  /** Top-down minimap at the viewport's bottom-left. */
  minimap: boolean;
  /** Steel deck ceiling with trusses and LED panels inside rooms. */
  ceiling: boolean;
  /** Use three's WebGPURenderer (falls back to WebGL when unavailable). Off = WebGL. */
  webgpu: boolean;
}

export type ActiveRenderer = "webgl" | "webgpu";

interface ViewportSettingsState extends ViewportSettings {
  /**
   * Transient (never persisted): fullscreen minimap covers the 3D view, so the scene renders in
   * performance mode without shadows/bloom. User prefs stay untouched; read via the select* helpers.
   */
  minimapFullscreen: boolean;
  /** Transient: the renderer the Canvas actually created (null until it exists). */
  activeRenderer: ActiveRenderer | null;
  /** Transient: why WebGPU was requested but WebGL runs (null = no notice). */
  rendererNotice: string | null;
  /** Transient: WebGPU init failed this session; the Canvas remounts as WebGL until the option is toggled. */
  webgpuFailed: boolean;
  setActiveRenderer: (renderer: ActiveRenderer, notice: string | null) => void;
  setWebGPUFailed: (failed: boolean) => void;
  setWebGPU: (enabled: boolean) => void;
  setMinimapFullscreen: (open: boolean) => void;
  setRenderQuality: (quality: RenderQuality) => void;
  setBloomEnabled: (enabled: boolean) => void;
  setShadowQuality: (quality: ShadowQuality) => void;
  togglePerfOverlay: () => void;
  togglePerfExpanded: () => void;
  toggleMinimap: () => void;
  setCeiling: (enabled: boolean) => void;
}

const DEFAULT_SETTINGS: ViewportSettings = {
  renderQuality: "balanced",
  bloomEnabled: true,
  shadowQuality: "high",
  perfOverlay: false,
  perfExpanded: false,
  minimap: false,
  ceiling: true,
  webgpu: false,
};

export const SETTINGS_COOKIE = "sf_settings";
const SETTINGS_VERSION = 1;

/** Per-field validation: anything missing or invalid falls back to its default. */
function sanitize(raw: unknown): ViewportSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    renderQuality:
      typeof value.renderQuality === "string" && value.renderQuality in RENDER_QUALITY
        ? (value.renderQuality as RenderQuality)
        : DEFAULT_SETTINGS.renderQuality,
    bloomEnabled:
      typeof value.bloomEnabled === "boolean" ? value.bloomEnabled : DEFAULT_SETTINGS.bloomEnabled,
    shadowQuality: SHADOW_QUALITIES.includes(value.shadowQuality as ShadowQuality)
      ? (value.shadowQuality as ShadowQuality)
      : DEFAULT_SETTINGS.shadowQuality,
    perfOverlay:
      typeof value.perfOverlay === "boolean" ? value.perfOverlay : DEFAULT_SETTINGS.perfOverlay,
    perfExpanded:
      typeof value.perfExpanded === "boolean" ? value.perfExpanded : DEFAULT_SETTINGS.perfExpanded,
    minimap: typeof value.minimap === "boolean" ? value.minimap : DEFAULT_SETTINGS.minimap,
    ceiling: typeof value.ceiling === "boolean" ? value.ceiling : DEFAULT_SETTINGS.ceiling,
    webgpu: typeof value.webgpu === "boolean" ? value.webgpu : DEFAULT_SETTINGS.webgpu,
  };
}

export const useViewportSettingsStore = create<ViewportSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      minimapFullscreen: false,
      activeRenderer: null,
      rendererNotice: null,
      webgpuFailed: false,
      setActiveRenderer: (activeRenderer, rendererNotice) => set({ activeRenderer, rendererNotice }),
      setWebGPUFailed: (webgpuFailed) => set({ webgpuFailed }),
      setWebGPU: (webgpu) => set({ webgpu, webgpuFailed: false, rendererNotice: null }),
      setMinimapFullscreen: (minimapFullscreen) => set({ minimapFullscreen }),
      setRenderQuality: (renderQuality) => set({ renderQuality }),
      setBloomEnabled: (bloomEnabled) => set({ bloomEnabled }),
      setShadowQuality: (shadowQuality) => set({ shadowQuality }),
      togglePerfOverlay: () => set((state) => ({ perfOverlay: !state.perfOverlay })),
      togglePerfExpanded: () => set((state) => ({ perfExpanded: !state.perfExpanded })),
      toggleMinimap: () =>
        set((state) => ({ minimap: !state.minimap, minimapFullscreen: false })),
      setCeiling: (ceiling) => set({ ceiling }),
    }),
    {
      name: SETTINGS_COOKIE,
      version: SETTINGS_VERSION,
      // A corrupt cookie throws inside persist's hydrate, which is caught, so defaults stay.
      storage: createJSONStorage(() => createCookieStorage()),
      partialize: ({ renderQuality, bloomEnabled, shadowQuality, perfOverlay, perfExpanded, minimap, ceiling, webgpu }) => ({
        renderQuality,
        bloomEnabled,
        shadowQuality,
        perfOverlay,
        perfExpanded,
        minimap,
        ceiling,
        webgpu,
      }),
      // Future schema changes: transform `persisted` by `version` here; sanitize() covers the rest.
      migrate: (persisted) => sanitize(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitize(persisted) }),
    },
  ),
);

/** Effective render settings for the scene (performance overrides while the minimap is fullscreen). */
export const selectRenderQuality = (state: ViewportSettingsState): RenderQuality =>
  state.minimapFullscreen ? "performance" : state.renderQuality;
export const selectBloomEnabled = (state: ViewportSettingsState) =>
  !state.minimapFullscreen && state.bloomEnabled;
export const selectShadowQuality = (state: ViewportSettingsState): ShadowQuality =>
  state.minimapFullscreen ? "off" : state.shadowQuality;
