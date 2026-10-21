import useMockEquipmentTelemetry from "@/hooks/useMockEquipmentTelemetry";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useShallow } from "zustand/react/shallow";
import boxUrl from "@/assets/models/box.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";
import { FactorySimulator } from "@/domain/simulation/FactorySimulator";
import type { SimulatorRunProps } from "@/viewport/simulation/types";
import { useSceneInstances } from "@/viewport/instancing/useInstanceModel";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useCargoStore } from "@/stores/useCargoStore";
import { simulationDelta } from "@/domain/simulation/simulationTime";

const REPORT_INTERVAL = 0.25;
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
  const world = useMemo(
    () => new FactorySimulator(objects, box.scene, pallet.scene, getSettings, instances ?? undefined),
    [objects, box.scene, pallet.scene, instances],
  );

  useEffect(() => {
    world.connectInstances();
    useCargoStore.getState().setRegistry(world.cargo);
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
    if (!running) return;

    world.advance(simulationDelta(delta, speed));
    reportElapsed.current += Math.min(delta, REPORT_INTERVAL);

    if (reportElapsed.current < REPORT_INTERVAL) return;

    reportElapsed.current = 0;
    onStats(world.stats);
    onProgress(world.placed, world.status);
    setEquipment(world.equipment);
    useCargoStore.getState().refresh();
  }, -2);

  return { world, objects, settings };
}
