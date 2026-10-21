import { SelectiveBloom, EffectComposer } from "@react-three/postprocessing";
import type { EffectComposer as EffectComposerImpl } from "postprocessing";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef, useState } from "react";
import type { RefObject } from "react";
import type { AmbientLight, Camera } from "three";

export default function PostProcessing({
  lights,
}: {
  lights: RefObject<AmbientLight | null>[];
}) {
  // The composer (and SelectiveBloom) rebuild every pass and render target whenever their camera
  // prop changes, which shows a blank/white frame. Pin them to the first camera and retarget the
  // existing passes when the editor swaps perspective <-> ortho instead.
  const get = useThree((state) => state.get);
  const [pinnedCamera] = useState(() => get().camera);
  const composer = useRef<EffectComposerImpl>(null);
  const mainCamera = useRef<Camera | null>(null);
  // Before the composer renders (priority 1) in the same frame the default camera changed.
  useFrame((state) => {
    if (!composer.current || mainCamera.current === state.camera) return;
    composer.current.setMainCamera(state.camera);
    mainCamera.current = state.camera;
  }, 0.5);

  return (
    // stencilBuffer: the selection outline masks its silhouette in the stencil buffer.
    <EffectComposer ref={composer} camera={pinnedCamera} multisampling={2} stencilBuffer>
      <SelectiveBloom
        lights={lights}
        ignoreBackground
        intensity={1}
        luminanceThreshold={2.5}
        luminanceSmoothing={0.03}
        mipmapBlur
        radius={0.85}
      />
    </EffectComposer>
  );
}