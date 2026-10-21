import { useSimulationStore } from "@/stores/useSimulationStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { cn } from "@/lib/style";

/**
 * Real device link when the snapshot carries device telemetry (source "device"): Connected / Offline.
 * Without a device source there is no connection to report, so it shows the simulation state instead.
 */
export default function ConnectionStatus() {
  // Primitive selector result (no new array per render): "none" | "online" | "offline".
  const link = useSimulationStore((state) => {
    const devices = Object.values(state.equipment?.telemetry ?? {}).filter((reading) => reading?.source === "device");
    if (!devices.length) return "none";
    return devices.some((reading) => reading.connection?.state === "online") ? "online" : "offline";
  });
  const running = useSimulationStore((state) => state.running);
  const stopped = useSceneStore((state) => state.editing);

  let label: string, dot: string;
  if (link !== "none") [label, dot] = link === "online" ? ["Connected", "bg-safe"] : ["Offline", "bg-offline"];
  else if (running) [label, dot] = ["Running", "bg-operating"];
  else if (!stopped) [label, dot] = ["Paused", "bg-warning"];
  else [label, dot] = ["Stopped", "bg-idle"];

  return (
    <span role="status" className="flex shrink-0 items-center gap-1.5 text-xs text-text-primary">
      <span aria-hidden className={cn("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}
