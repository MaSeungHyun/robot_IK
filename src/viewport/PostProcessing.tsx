import { SelectiveBloom, EffectComposer } from "@react-three/postprocessing";
import type { RefObject } from "react";
import type { AmbientLight } from "three";

export default function PostProcessing({
  lights,
}: {
  lights: RefObject<AmbientLight | null>[];
}) {
  return (
    // stencilBuffer: the selection outline masks its silhouette in the stencil buffer.
    <EffectComposer multisampling={2} stencilBuffer>
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
