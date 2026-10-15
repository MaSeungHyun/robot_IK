import { useEffect } from "react";
import type { JointAngleRef } from "../types/robot";
import { useSimulationStore } from "../stores/useSimulationStore";

/** Sample the animation reference at UI frequency instead of rendering every frame. */
export function useJointAngleReadings(readings: JointAngleRef) {
  const setAngles = useSimulationStore(state => state.setAngles);
  useEffect(() => {
    const timer = window.setInterval(() => setAngles(readings.current), 100);
    return () => window.clearInterval(timer);
  }, [readings, setAngles]);
}
