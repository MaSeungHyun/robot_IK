import { Canvas } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import { Suspense, useCallback, useMemo, useRef } from "react";
import { Selection } from "@react-three/postprocessing";
import type { AmbientLight } from "three";
import SceneBoundary from "@/viewport/SceneBoundary";
import { useShallow } from "zustand/react/shallow";
import { useSimulationStore } from "@/stores/useSimulationStore";
import SimulatorScene from "@/viewport/SimulatorScene";
import { useSceneStore } from "@/stores/useSceneStore";
import ModelWarmup from "@/viewport/ModelWarmup";
import ProgramPin from "@/viewport/ProgramPin";
import ModelLoader from "@/viewport/models/ModelLoader";
import ThumbnailBaker from "@/viewport/thumbnails/ThumbnailBaker";
import CameraTracker from "@/viewport/camera/CameraTracker";
import CameraRig from "@/viewport/camera/CameraRig";
import ShadowLight from "@/viewport/shadows/ShadowLight";
import WorldAxes from "@/viewport/WorldAxes";
import PostProcessing from "./PostProcessing";
import { RENDER_QUALITY } from "@/constants/viewport";
import {
  selectRenderQuality,
  useViewportSettingsStore,
} from "@/stores/useViewportSettingsStore";
import PerfReadout, { PerfCollector } from "./PerfOverlay";
import Minimap from "@/viewport/minimap/Minimap";
import MinimapProbe from "@/viewport/minimap/MinimapProbe";
import WalkControls from "@/viewport/walk/WalkControls";

const CAMERA = { position: [5, 4.5, 6] as [number, number, number], fov: 45 };

export default function Viewport() {
  const renderQuality = useViewportSettingsStore(
    selectRenderQuality,
  );
  const ambientLight = useRef<AmbientLight>(null);
  const bloomLights = useMemo(() => [ambientLight], []);
  const { transferMode, run, running, setStats, setProgress } =
    useSimulationStore(
      useShallow((s) => ({
        transferMode: s.transferMode,
        run: s.run,
        running: s.running,
        setStats: s.setStats,
        setProgress: s.setProgress,
      })),
    );

  const onProgress = useCallback(
    (count: number, status: string) => setProgress({ count, status }),
    [setProgress],
  );

  return (
    <div className="relative h-full w-full bg-[#101820]">
      <SceneBoundary resetKey={run}>
        <Canvas
          camera={CAMERA}
          // No canvas MSAA: the EffectComposer renders the frame with its own multisampling.
          gl={{ antialias: false, stencil: true }}
          shadows="percentage"
          dpr={[1, RENDER_QUALITY[renderQuality].maxDpr]}
          onCreated={({ gl }) => {
            // Synchronous shader error checks block on every compile; keep them for development.
            if (import.meta.env.PROD) gl.debug.checkShaderErrors = false;
          }}
          onPointerMissed={(event) => {
            if (
              event.button === 0 &&
              event.detail <= 1 &&
              !useSceneStore.getState().pending
            )
              useSceneStore.getState().select(null);
          }}
        >
          <Grid
            infiniteGrid
            followCamera
            cellSize={0.25}
            sectionSize={1}
            // cellColor="#23313e"
            // sectionColor="#344656"
            cellColor="#666666"
            sectionColor="#555555"
            fadeDistance={1000}
            position={[0, -0.01, 0]}
          />
          <WorldAxes />

          <CameraRig />
          <CameraTracker />
          <WalkControls />
          {import.meta.env.DEV && <PerfCollector />}
          <MinimapProbe />
          <Selection>
            {/* <color attach="background" args={["#101820"]} /> */}
            <ambientLight ref={ambientLight} intensity={2} />
            <ShadowLight />

            <ModelLoader />
            <ModelWarmup />
            <ProgramPin />
            <ThumbnailBaker />
            <Suspense fallback={null}>
              <SimulatorScene
                simulationRun={run}
                running={running}
                transferMode={transferMode}
                onStats={setStats}
                onProgress={onProgress}
              />
            </Suspense>
            <PostProcessing lights={bloomLights} />
          </Selection>
        </Canvas>
      </SceneBoundary>
      {import.meta.env.DEV && <PerfReadout />}
      <Minimap />
    </div>
  );
}
