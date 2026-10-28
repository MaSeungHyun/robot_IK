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
import ShuttleZones from "@/viewport/editor/ShuttleZones";
import PostProcessing from "./PostProcessing";
import WebGPUFrame from "@/viewport/renderer/WebGPUFrame";
import { createRenderer, isWebGPURenderer } from "@/viewport/renderer/createRenderer";
import { configureKTX2 } from "@/lib/three/gltfLoader";
import { RENDER_QUALITY } from "@/constants/viewport";
import {
  selectRenderQuality,
  useViewportSettingsStore,
} from "@/stores/useViewportSettingsStore";
import PerfReadout, { PerfCollector } from "./PerfOverlay";
import Minimap from "@/viewport/minimap/Minimap";
import MinimapProbe from "@/viewport/minimap/MinimapProbe";
import WalkControls from "@/viewport/walk/WalkControls";
import FactoryLighting from "@/viewport/lighting/FactoryLighting";

const CAMERA = { position: [5, 4.5, 6] as [number, number, number], fov: 45 };

export default function Viewport() {
  const renderQuality = useViewportSettingsStore(selectRenderQuality);
  // Requested renderer; a failed WebGPU init remounts as WebGL until the option is toggled again.
  const wantWebGPU = useViewportSettingsStore((s) => s.webgpu && !s.webgpuFailed);
  const webgpu = useViewportSettingsStore((s) => s.activeRenderer === "webgpu");
  const ambientLight = useRef<AmbientLight>(null);
  // Template lighting preset (factory.glb lights + HDR) replaces the default ambient + key light.
  const lighting = useSceneStore((state) => state.lighting);
  // Editor grid: edit mode only, hidden while the simulation plays.
  const showGrid = useSceneStore((state) => state.editing);
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
          // Switching renderer needs a fresh canvas and root; R3F disposes the old renderer on unmount.
          key={wantWebGPU ? "webgpu" : "webgl"}
          camera={CAMERA}
          // WebGL: no canvas MSAA (the EffectComposer multisamples), stencil for the outline. See createRenderer.
          gl={(props) => createRenderer(props, wantWebGPU)}
          shadows="percentage"
          dpr={[1, RENDER_QUALITY[renderQuality].maxDpr]}
          onCreated={({ gl }) => {
            // KTX2 textures (optimized GLBs): pick transcode targets for this renderer.
            configureKTX2(gl);
            // Synchronous shader error checks block on every compile; keep them for development.
            if (import.meta.env.PROD && !isWebGPURenderer(gl)) gl.debug.checkShaderErrors = false;
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
          {showGrid && (webgpu ? (
            // drei Grid is a GLSL ShaderMaterial (WebGL only): a finite line grid, same cell/section colours.
            <gridHelper args={[200, 800, "#555555", "#666666"]} position={[0, -0.01, 0]} />
          ) : (
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
          ))}
          {showGrid && <WorldAxes />}
          <ShuttleZones />

          <CameraRig />
          <CameraTracker />
          <WalkControls />
          {import.meta.env.DEV && <PerfCollector />}
          <MinimapProbe />
          <Selection>
            {/* <color attach="background" args={["#101820"]} /> */}
            <ambientLight ref={ambientLight} intensity={2} visible={!lighting} />
            {lighting === "factory" ? <FactoryLighting /> : <ShadowLight />}

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
            {webgpu ? <WebGPUFrame /> : <PostProcessing lights={bloomLights} toneMapping={lighting === "factory" ? "agx" : undefined} />}
          </Selection>
        </Canvas>
      </SceneBoundary>
      {import.meta.env.DEV && <PerfReadout />}
      <Minimap />
    </div>
  );
}
