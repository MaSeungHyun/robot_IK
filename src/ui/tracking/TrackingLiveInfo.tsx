import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { AGENT_LABELS } from "@/ui/Hud/equipment/amr/constants";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { SceneObjectResolver, worldYaw } from "@/viewport/scene/sceneObjects";

/** Refresh rate of the live readout (~10 Hz); text nodes are written directly, no React state. */
const INTERVAL_MS = 100;
/** Speed smoothing per update (0..1, higher = more responsive). */
const SPEED_SMOOTHING = 0.35;

type Props = { id: string; amr: boolean };

/** Live pose (and AMR status/battery/speed) inside the TRACKING ACTIVE label. */
export default function TrackingLiveInfo({ id, amr }: Props) {
  const position = useRef<HTMLSpanElement>(null);
  const heading = useRef<HTMLSpanElement>(null);
  const status = useRef<HTMLSpanElement>(null);
  const battery = useRef<HTMLSpanElement>(null);
  const speed = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const resolver = new SceneObjectResolver(),
      point = new Vector3(),
      last = new Vector3();
    let lastAt = 0,
      smoothed = 0;
    const write = (node: HTMLSpanElement | null, value: string) => {
      if (node && node.textContent !== value) node.textContent = value;
    };
    const update = () => {
      const object = resolver.resolve(id);
      if (!object) {
        write(position.current, "—");
        write(heading.current, "—");
        return;
      }
      object.getWorldPosition(point);
      write(
        position.current,
        `x ${point.x.toFixed(2)} \n z ${point.z.toFixed(2)}`,
      );
      write(
        heading.current,
        `${(((worldYaw(object) * 180) / Math.PI + 360) % 360).toFixed(0)}°`,
      );
      if (!amr) return;
      const now = performance.now();
      if (lastAt) {
        // Simulation seconds, so the readout is the same at any playback speed (배속).
        const dt =
          ((now - lastAt) / 1000) * useSimulationStore.getState().speed;
        if (dt > 0)
          smoothed +=
            (Math.hypot(point.x - last.x, point.z - last.z) / dt - smoothed) *
            SPEED_SMOOTHING;
      }
      last.copy(point);
      lastAt = now;
      write(speed.current, `${smoothed.toFixed(2)} m/s`);
      const agent = useSimulationStore
        .getState()
        .equipment?.agents.find((candidate) => candidate.id === id);
      write(
        status.current,
        agent
          ? (AGENT_LABELS[agent.state as keyof typeof AGENT_LABELS] ??
              String(agent.state))
          : "—",
      );
      write(
        battery.current,
        agent && Number.isFinite(agent.battery)
          ? `${Math.round(agent.battery)}%`
          : "—",
      );
    };
    update();
    const timer = window.setInterval(update, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [id, amr]);

  const row = "flex justify-between gap-3 whitespace-nowrap";
  const label = "text-text-secondary whitespace-nowrap";

  return (
    <dl className="mt-1.5 grid gap-0.5 border-t border-brand-primary/30 pt-1.5 text-xs tabular-nums text-text-primary pb-1 gap-1">
      <div className={row}>
        <dt className={label}>POS</dt>
        <dd>
          <span ref={position} className="whitespace-pre-line">
            —
          </span>
        </dd>
      </div>
      <div className={row}>
        <dt className={label}>HDG</dt>
        <dd>
          <span ref={heading}>—</span>
        </dd>
      </div>
      {amr && (
        <>
          <div className={row}>
            <dt className={label}>STATE</dt>
            <dd>
              <span ref={status}>—</span>
            </dd>
          </div>
          <div className={row}>
            <dt className={label}>BATT</dt>
            <dd>
              <span ref={battery}>—</span>
            </dd>
          </div>
          <div className={row}>
            <dt className={label}>SPD</dt>
            <dd>
              <span ref={speed}>—</span>
            </dd>
          </div>
        </>
      )}
    </dl>
  );
}
