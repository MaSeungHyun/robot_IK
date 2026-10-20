import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { lazy, Suspense, useCallback, useMemo } from "react";
import SceneBoundary from "@/features/Viewport/SceneBoundary";
import { useShallow } from "zustand/react/shallow";
import { useSimulationStore } from "@/stores/useSimulationStore";
import SimulatorScene from "@/features/simulator/SimulatorScene";
import { useSceneStore } from "@/stores/useSceneStore";
import ModelWarmup from "@/features/Viewport/ModelWarmup";

const ConveyorDemo = lazy(() => import("@/legacy/conveyor/ConveyorDemo"));
const RobotDemo = lazy(() => import("@/legacy/robot/RobotDemo"));
const AMRDemo = lazy(() => import("@/legacy/amr/AMRDemo"));

export default function Viewport() {
  const drawingFloor = useSceneStore((state) => state.editing && state.pending === "floor");
  const {
    sceneMode,
    transferMode,
    run,
    running,
    setStats,
    setProgress,
    setDiagnostics,
  } = useSimulationStore(
    useShallow((s) => ({
      sceneMode: s.sceneMode,
      transferMode: s.transferMode,
      run: s.run,
      running: s.running,
      setStats: s.setStats,
      setProgress: s.setProgress,
      setDiagnostics: s.setDiagnostics,
    })),
  );

  const amr = sceneMode === "amr";
  const batch = sceneMode === "robot";
  const simulator = sceneMode === "simulator";

  const camera = useMemo(
    () => ({
      position: (amr
        ? [9, 10, 11]
        : simulator
          ? [5, 4.5, 6]
          : batch
            ? [4, 3.5, 5]
            : [3, 2.2, 3]) as [number, number, number],
      fov: 45,
    }),
    [amr, batch, simulator],
  );

  const onProgress = useCallback(
    (count: number, status: string) => setProgress({ count, status }),
    [setProgress],
  );

  return (
    <div className="relative h-full w-full bg-[#101820]">
      <SceneBoundary key={sceneMode} resetKey={run}>
        <Canvas
          key={sceneMode}
          camera={camera}
          gl={{ antialias: true }}
          dpr={[1, 1.5]}
          onCreated={({ gl }) => {
            // Synchronous shader error checks block on every compile; keep them for development.
            if (import.meta.env.PROD) gl.debug.checkShaderErrors = false;
          }}
          onPointerMissed={(event) => {
            if (
              simulator &&
              event.button === 0 &&
              event.detail <= 1 &&
              !useSceneStore.getState().pending
            )
              useSceneStore.getState().select(null);
          }}
        >
          <color attach="background" args={["#101820"]} />
          <ambientLight intensity={2} />
          <directionalLight position={[3, 8, 4]} intensity={2} />

          <Grid
            infiniteGrid
            followCamera
            cellSize={0.25}
            sectionSize={1}
            // cellColor="#23313e"
            // sectionColor="#344656"
            cellColor="#666666"
            sectionColor="#555555"
            fadeDistance={500}
            position={[0, -0.01, 0]}
          />

          <OrbitControls
            makeDefault
            enableRotate={!drawingFloor}
            target={[0, amr ? 0 : batch ? 0.8 : 0.45, 0]}
            enableDamping={false}
            maxPolarAngle={Math.PI / 2.05}
          />
          <Suspense fallback={null}>
            <ModelWarmup />
          </Suspense>
          <Suspense fallback={null}>
            {simulator ? (
              <SimulatorScene
                simulationRun={run}
                running={running}
                transferMode={transferMode}
                onStats={setStats}
                onProgress={onProgress}
              />
            ) : amr ? (
              <AMRDemo
                key={run}
                running={running}
                onStats={setStats}
                onProgress={onProgress}
              />
            ) : batch ? (
              <RobotDemo
                key={run}
                transferMode={transferMode}
                running={running}
                onProgress={onProgress}
              />
            ) : (
              <ConveyorDemo
                key={run}
                transferMode={transferMode}
                running={running}
                onStats={setStats}
                onDiagnostics={setDiagnostics}
                onProgress={onProgress}
              />
            )}
          </Suspense>
        </Canvas>
      </SceneBoundary>
    </div>
  );
}
