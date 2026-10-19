import { useSimulationStore } from "@/stores/useSimulationStore";

export default function useEquipmentTelemetry(id: string) {
  return useSimulationStore((state) => state.equipment?.telemetry?.[id] ?? state.mockTelemetry[id]);
}
