import useMockEquipmentTelemetry from "@/hooks/useMockEquipmentTelemetry";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@/lib/three/gltfLoader";
import { useShallow } from "zustand/react/shallow";
import { boxUrl, palletUrl } from "@/constants/modelAssets";
import { FactorySimulator } from "@/domain/simulation/FactorySimulator";
import type { SimulatorRunProps } from "@/viewport/simulation/types";
import { useSceneInstances } from "@/viewport/instancing/useInstanceModel";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useCargoStore } from "@/stores/useCargoStore";
import { useKpiStore } from "@/stores/useKpiStore";
import { DEFAULT_KPI_CONFIG } from "@/domain/kpi/KpiCollector";
import { simulationClock } from "@/domain/simulation/simulationClock";
import { ikSolveStats } from "@/domain/robot/ik/robotIK";
import { log } from "@/stores/useLogStore";
import { profileEnd, profileStart } from "@/lib/profiler/frameProfiler";

const REPORT_INTERVAL = 0.25;
/** Log the IK solve-path counters once per this many plans (dev diagnostics, kept sparse). */
const IK_LOG_EVERY = 50;
const getSettings = () => useSceneStore.getState().settings;

export default function useFactoryRuntime({ running, onStats, onProgress }: SimulatorRunProps) {
  const speed = useSimulationStore((state) => state.speed);
  const setEquipment = useSimulationStore((state) => state.setEquipment);
  const { objects, settings } = useSceneStore(useShallow((state) => ({
    objects: state.objects,
    settings: state.settings,
  })));

  useMockEquipmentTelemetry(objects, running);

  const instances = useSceneInstances();
  const box = useGLTF(boxUrl);
  const pallet = useGLTF(palletUrl);
  const reportElapsed = useRef(0);
  const ikLogged = useRef(0);
  const world = useMemo(
    // Links only change in edit mode, where no run is mounted; read them once per run.
    () => new FactorySimulator(objects, box.scene, pallet.scene, getSettings, instances ?? undefined, undefined, useSceneStore.getState().links, useSceneStore.getState().autoConnect),
    [objects, box.scene, pallet.scene, instances],
  );

  // A new world (new run / reset) starts the shared fixed-step clock from zero.
  useEffect(() => { simulationClock.reset(); }, [world]);

  // KPI sampling uses the fixed defaults (DEFAULT_KPI_CONFIG); publish the mounted world's report.
  useEffect(() => {
    world.kpi.configure(DEFAULT_KPI_CONFIG);
    useKpiStore.getState().setReport(world.kpi.report());
    return () => { useKpiStore.getState().setReport(null); };
  }, [world]);

  useEffect(() => {
    world.connectInstances();
    useCargoStore.getState().setRegistry(world.cargo, world.transport);
    return () => {
      world.dispose();
      // STOP (or a new run) clears box records and the box selection.
      useCargoStore.getState().setRegistry(null);
    };
  }, [world]);

  useEffect(() => {
    onStats(world.stats);
    onProgress(0, world.status);
    setEquipment(world.equipment);

    return () => setEquipment(null);
  }, [world, onStats, onProgress, setEquipment]);

  useFrame((_, delta) => {
    // One fixed-step clock per frame: boxes/belts/AMRs and every robot advance together (robots register in Robot.tsx).
    simulationClock.frame(delta, running ? speed : 0, world);
    if (!running) return;

    reportElapsed.current += Math.min(delta, REPORT_INTERVAL);

    if (reportElapsed.current < REPORT_INTERVAL) return;

    reportElapsed.current = 0;
    const reportStart = profileStart();
    onStats(world.stats);
    onProgress(world.placed, world.status);
    setEquipment(world.equipment);
    useCargoStore.getState().refresh();
    useKpiStore.getState().setReport(world.kpi.report());
    const ik = ikSolveStats, plans = ik.analytic + ik.tilt + ik.numeric + ik.rrt + ik.failed;
    if (plans - ikLogged.current >= IK_LOG_EVERY) {
      ikLogged.current = plans;
      log("info", "IK 해법 경로", `해석 ${ik.analytic} / 기울임 ${ik.tilt} / 수치 ${ik.numeric} / RRT ${ik.rrt} / 실패 ${ik.failed} · 직선 해석 ${ik.cartesianAnalytic} / 수치 ${ik.cartesianNumeric}`);
    }
    profileEnd("report", reportStart);
  }, -2);

  return { world, objects, settings };
}
