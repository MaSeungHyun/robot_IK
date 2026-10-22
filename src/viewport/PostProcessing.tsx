import {
  SelectiveBloom,
  EffectComposer,
  selectionContext,
} from "@react-three/postprocessing";
import type { EffectComposer as EffectComposerImpl } from "postprocessing";
import { useFrame, useThree } from "@react-three/fiber";
import { useContext, useRef, useState } from "react";
import type { RefObject } from "react";
import type { AmbientLight, Camera } from "three";
import { RENDER_QUALITY } from "@/constants/viewport";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";

export default function PostProcessing({
  lights,
}: {
  lights: RefObject<AmbientLight | null>[];
}) {
  const renderQuality = useViewportSettingsStore(
    (state) => state.renderQuality,
  );
  const bloomEnabled = useViewportSettingsStore((state) => state.bloomEnabled);
  const selection = useContext(selectionContext);
  const bloomActive = bloomEnabled && (selection?.selected.length ?? 0) > 0;
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
    >
      {bloomActive && (
        <SelectiveBloom
          lights={lights}
          ignoreBackground
          intensity={0.8}
          luminanceThreshold={1.5}
          luminanceSmoothing={0.03}
          mipmapBlur
          // 기본 8단계 → 5단계: 작은 발광부(AMR 램프)엔 충분하고 전체 화면 패스가 절반 가까이 줄어듦.
          levels={3}
          radius={0.85}
        />
      )}
    </EffectComposer>
  );
}
