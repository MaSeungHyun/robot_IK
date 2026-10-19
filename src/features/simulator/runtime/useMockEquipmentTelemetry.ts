import { useEffect } from "react";
import { MOCK_TELEMETRY_CONFIG } from "@/constants/telemetry";
import { createMockTelemetry } from "@/mock/equipmentTelemetry";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import type { SceneEquipment } from "@/types/layout";

export default function useMockEquipmentTelemetry(objects: SceneEquipment[], running: boolean) {
  const run = useSimulationStore((state) => state.run);
  const setMockTelemetry = useSimulationStore((state) => state.setMockTelemetry);

  useEffect(() => {
    function update() {
      const previous = useSimulationStore.getState().mockTelemetry;
      setMockTelemetry(createMockTelemetry(objects, useSceneStore.getState().settings, previous));
    }

    const previous = useSimulationStore.getState().mockTelemetry;
    if (objects.some((object) => !previous[object.id])) update();
    if (!running || objects.length === 0) return;

    const timer = window.setInterval(update, MOCK_TELEMETRY_CONFIG.intervalMs);
    return () => window.clearInterval(timer);
  }, [objects, running, run, setMockTelemetry]);
}
