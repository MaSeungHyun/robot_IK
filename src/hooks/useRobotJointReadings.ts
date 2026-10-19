import { useEffect } from "react";
import type { RefObject } from "react";
import { JOINT_READINGS_INTERVAL_MS } from "@/constants/telemetry";
import type { RobotController } from "@/interface/RobotController";
import { useSimulationStore } from "@/stores/useSimulationStore";

export default function useRobotJointReadings(id: string | undefined, controller: RefObject<RobotController | null>) {
  const setReadings = useSimulationStore((state) => state.setRobotJointAngles);
  const removeReadings = useSimulationStore((state) => state.removeRobotJointAngles);

  useEffect(() => {
    if (!id) return;

    function sample() {
      const instance = controller.current;
      if (!instance || !id) return;

      const readings = instance.getJointAngles().map(({ name, axis, degrees, locked, min, max }) => ({
        name, axis, degrees, locked, min, max,
      }));
      setReadings(id, readings);
    }

    sample();
    const timer = window.setInterval(sample, JOINT_READINGS_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      removeReadings(id);
    };
  }, [id, controller, setReadings, removeReadings]);
}
