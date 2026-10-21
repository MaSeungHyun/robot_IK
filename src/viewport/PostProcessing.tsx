import { SelectiveBloom, EffectComposer } from "@react-three/postprocessing";
import type { RefObject } from "react";
import type { AmbientLight } from "three";

export default function PostProcessing({ lights }: { lights: RefObject<AmbientLight | null>[] }) {
  return (
    <EffectComposer multisampling={4}>
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
