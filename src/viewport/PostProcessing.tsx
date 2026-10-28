import {
  SelectiveBloom,
  EffectComposer,
  ToneMapping,
  selectionContext,
} from "@react-three/postprocessing";
import { ToneMappingMode, type EffectComposer as EffectComposerImpl, type SelectiveBloomEffect } from "postprocessing";
import { useFrame, useThree } from "@react-three/fiber";
import { useContext, useRef, useState } from "react";
import type { RefObject } from "react";
import { HalfFloatType, Matrix4 } from "three";
import type { AmbientLight, Camera } from "three";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { RENDER_QUALITY } from "@/constants/viewport";
import { usePostWarmup } from "@/viewport/postWarmupState";
import {
  selectBloomEnabled,
  selectRenderQuality,
  useViewportSettingsStore,
} from "@/stores/useViewportSettingsStore";

/** Bloom buffer scale vs the drawing buffer: normal / while the camera moves or playback >= FAST_SPEED. */
const BLOOM_SCALE = 0.5;
const BLOOM_SCALE_BUSY = 0.25;
const FAST_SPEED = 4;
/** Full-quality bloom comes back after the camera has been still this long (ms). */
const BLOOM_IDLE_MS = 400;

export default function PostProcessing({
  lights,
  toneMapping,
}: {
  lights: RefObject<AmbientLight | null>[];
  /** The composer forces the renderer to NoToneMapping; "agx" adds an AgX pass at the end (factory lighting). */
  toneMapping?: "agx";
}) {
  const renderQuality = useViewportSettingsStore(selectRenderQuality);
  const bloomEnabled = useViewportSettingsStore(selectBloomEnabled);
  const selection = useContext(selectionContext);
  const warming = usePostWarmup((state) => state.active);
  const bloomActive = bloomEnabled && ((selection?.selected.length ?? 0) > 0 || warming);
  // The composer (and SelectiveBloom) rebuild every pass and render target whenever their camera
  // prop changes, which shows a blank/white frame. Pin them to the first camera and retarget the
  // existing passes when the editor swaps perspective <-> ortho instead.
  const get = useThree((state) => state.get);
  const [pinnedCamera] = useState(() => get().camera);
  const composer = useRef<EffectComposerImpl>(null);
  const mainCamera = useRef<Camera | null>(null);
  const mainComposer = useRef<EffectComposerImpl | null>(null);
  const mainPass = useRef<EffectComposerImpl["passes"][number] | undefined>(
    undefined,
  );
  const bloom = useRef<SelectiveBloomEffect>(null);
  const lastView = useRef(new Matrix4());
  const movedAt = useRef(-Infinity);
  // Adaptive quality: lower the bloom buffer (resize only, no shader recompile / composer remount) while the
  // camera moves (orbit, walk, tween, follow) or playback runs fast; restore after BLOOM_IDLE_MS of stillness.
  useFrame((state) => {
    const effect = bloom.current;
    if (!effect) return;
    const now = performance.now();
    if (!lastView.current.equals(state.camera.matrixWorld)) {
      lastView.current.copy(state.camera.matrixWorld);
      movedAt.current = now;
    }
    const { running, speed } = useSimulationStore.getState();
    const busy = (running && speed >= FAST_SPEED) || now - movedAt.current < BLOOM_IDLE_MS;
    const scale = busy ? BLOOM_SCALE_BUSY : BLOOM_SCALE;
    if (effect.resolution.scale !== scale) effect.resolution.scale = scale;
  }, 0.4);
  // Before the composer renders (priority 1) in the same frame the default camera changed.
  useFrame((state) => {
    if (!composer.current) return;
    const lastPass = composer.current.passes.at(-1);
    // Changing MSAA rebuilds the composer; toggling bloom rebuilds its pass chain. Both must
    // inherit the current camera even when it is still the same orthographic editor camera.
    if (
      mainCamera.current === state.camera &&
      mainComposer.current === composer.current &&
      mainPass.current === lastPass
    )
      return;
    composer.current.setMainCamera(state.camera);
    mainCamera.current = state.camera;
    mainComposer.current = composer.current;
    mainPass.current = lastPass;
  }, 0.5);

  return (
    // stencilBuffer: the selection outline masks its silhouette in the stencil buffer.
    <EffectComposer
      ref={composer}
      camera={pinnedCamera}
      multisampling={RENDER_QUALITY[renderQuality].multisampling}
      stencilBuffer
      // HalfFloat kept on purpose: UnsignedByte clamps at 1.0, so the HDR threshold (1.5) would never bloom.
      frameBufferType={HalfFloatType}
    >
      {bloomActive && (
        <SelectiveBloom
          lights={lights}
          ignoreBackground
          ref={bloom}
          intensity={0.8}
          // HDR only (> 1): plain lit surfaces never bloom, only the emissive AMR lamps.
          luminanceThreshold={1.5}
          luminanceSmoothing={0.1}
          mipmapBlur
          // Half-resolution bloom; drops to BLOOM_SCALE_BUSY adaptively (see above).
          resolutionScale={BLOOM_SCALE}
          // Mip levels: 1 (default 8) is enough for the small lamp glows.
          levels={1}
          radius={0.7}
        />
      )}
      {toneMapping === "agx" || warming ? <ToneMapping mode={ToneMappingMode.AGX} /> : <></>}
    </EffectComposer>
  );
}
