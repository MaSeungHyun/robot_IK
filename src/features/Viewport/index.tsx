import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, useProgress } from "@react-three/drei";
import { Component, Suspense, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSimulationStore } from "../../stores/useSimulationStore";
import SimulationPanel from "@/features/Hud/simulation/SimulationPanel";
import ConveyorDemo from "@/demo/conveyor/ConveyorDemo";
import RobotDemo from "@/demo/robot/RobotDemo";
import AMRDemo from "@/demo/amr/AMRDemo";
import CustomizeDemo from "@/demo/customize/CustomizeDemo";
import AssetPalettePanel from "@/features/Hud/customize/AssetPalettePanel";
import ObjectPropertiesPanel from "@/features/Hud/customize/ObjectPropertiesPanel";
import EquipmentStatusPanel from "@/features/Hud/customize/EquipmentStatusPanel";
import { useSceneStore } from "../../stores/useSceneStore";
import useEditorShortcuts from "../../hooks/useEditorShortcuts";

class SceneBoundary extends Component<
  { children: ReactNode; resetKey: number },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: { resetKey: number }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? (
      <p
        role="alert"
        className="absolute bottom-6 right-6 rounded-xl bg-slate-900 p-4 text-sm text-rose-300"
      >
        모델을 불러오지 못했습니다. 초기화 후 다시 시도해 주세요.
      </p>
    ) : (
      this.props.children
    );
  }
}
function LoadingOverlay() {
  const active = useProgress((state) => state.active);
  return active ? (
    <p
      role="status"
      className="pointer-events-none absolute right-5 top-5 z-10 rounded-xl bg-slate-900/90 px-4 py-3 text-sm text-slate-300"
    >
      모델 불러오는 중…
    </p>
  ) : null;
}

export default function Viewport() {
  const editing=useSceneStore(state=>state.editing);
  const {
    demoMode,
    transferMode,
    run,
    running,
    setStats,
    setProgress,
    setDiagnostics,
  } = useSimulationStore(
    useShallow((s) => ({
      demoMode: s.demoMode,
      transferMode: s.transferMode,
      run: s.run,
      running: s.running,
      setStats: s.setStats,
      setProgress: s.setProgress,
      setDiagnostics: s.setDiagnostics,
    })),
  );
  const amr = demoMode === "amr",
    batch = demoMode === "robot",
    custom = demoMode === "customize";
  useEditorShortcuts(custom);
  const camera = useMemo(
    () => ({
      position: (amr
        ? [9, 10, 11]
        : custom
          ? [5, 4.5, 6]
          : batch
            ? [4, 3.5, 5]
            : [3, 2.2, 3]) as [number, number, number],
      fov: 45,
    }),
    [amr, batch, custom],
  );
  const onProgress = useCallback(
    (count: number, status: string) => setProgress({ count, status }),
    [setProgress],
  );
  return (
    <div className="relative h-full w-full bg-[#101820]">
      <SimulationPanel />
      {custom && (
        <>
          <AssetPalettePanel />
          {editing?<ObjectPropertiesPanel />:<EquipmentStatusPanel/>}
        </>
      )}
      <LoadingOverlay />
      <SceneBoundary key={demoMode} resetKey={run}>
        <Canvas
          key={demoMode}
          camera={camera}
          gl={{ antialias: true }}
          dpr={[1, 1.5]}
        >
          <color attach="background" args={["#101820"]} />
          <ambientLight intensity={2} />
          <directionalLight position={[3, 8, 4]} intensity={2} />

          <Grid
            infiniteGrid
            followCamera
            cellSize={0.25}
            sectionSize={1}
            cellColor="#23313e"
            sectionColor="#344656"
            fadeDistance={500}
            position={[0, -0.01, 0]}
          />

          <OrbitControls
            makeDefault
            target={[0, amr ? 0 : batch ? 0.8 : 0.45, 0]}
            enableDamping={false}
            maxPolarAngle={Math.PI / 2.05}
          />
          <Suspense fallback={null}>
            {custom ? (
              <CustomizeDemo
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
