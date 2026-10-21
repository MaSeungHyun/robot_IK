import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { AGENT_LABELS } from "@/ui/Hud/equipment/amr/constants";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { SceneObjectResolver, worldYaw } from "@/viewport/scene/sceneObjects";
import { EQUIPMENT_REPORT_INTERVAL_MS, TELEMETRY_INTERPOLATION } from "@/constants/telemetry";
import { BufferedScalar, lerpAngleDeg, smoothingAlpha } from "@/lib/interpolation";

/** Display smoothing time constants (wall ms): pose follows the moving model closely, speed is a noisier derivative. */
const POSE_TAU_MS = 80;
const SPEED_TAU_MS = 300;

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
      last = new Vector3(),
      shown = new Vector3();
    const battery_ = new BufferedScalar(EQUIPMENT_REPORT_INTERVAL_MS, EQUIPMENT_REPORT_INTERVAL_MS * TELEMETRY_INTERPOLATION.smoothingTauRatio);
    let frame = 0, lastFrame = 0, lastWrite = 0, speedValue = 0, headingDeg: number | undefined, primed = false;
    let source = useSimulationStore.getState().equipment;
    const write = (node: HTMLSpanElement | null, value: string) => {
      if (node && node.textContent !== value) node.textContent = value;
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dtMs = lastFrame ? now - lastFrame : 0;
      lastFrame = now;
      const object = resolver.resolve(id);
      if (!object) {
        primed = false;
        write(position.current, "—");
        write(heading.current, "—");
        return;
      }
      object.getWorldPosition(point);
      const yaw = (((worldYaw(object) * 180) / Math.PI) % 360 + 360) % 360;
      const pose = smoothingAlpha(dtMs, POSE_TAU_MS);
      if (!primed) {
        shown.copy(point);
        last.copy(point);
        headingDeg = yaw;
        primed = true;
      } else {
        shown.lerp(point, pose);
        headingDeg = lerpAngleDeg(headingDeg ?? yaw, yaw, pose);
        // Simulation seconds, so the readout is the same at any playback speed (배속).
        const simSeconds = (dtMs / 1000) * useSimulationStore.getState().speed;
        if (amr && simSeconds > 0) {
          const measured = Math.hypot(point.x - last.x, point.z - last.z) / simSeconds;
          speedValue += (measured - speedValue) * smoothingAlpha(dtMs, SPEED_TAU_MS);
        }
        last.copy(point);
      }

      const state = useSimulationStore.getState();
      const agent = amr ? state.equipment?.agents.find((candidate) => candidate.id === id) : undefined;
      if (state.equipment !== source) {
        source = state.equipment;
        const level = agent ? (state.equipment?.telemetry?.[id]?.batteryPercent ?? agent.battery) : undefined;
        if (level !== undefined && Number.isFinite(level)) battery_.push(level, now);
      }
      const batteryShown = battery_.sample(now);

      if (now - lastWrite < TELEMETRY_INTERPOLATION.textUpdateMs) return;
      lastWrite = now;
      // Position keeps its intentional 2 decimals (cm); other continuous values use 1 fixed decimal.
      write(position.current, `x ${shown.x.toFixed(2)} \n z ${shown.z.toFixed(2)}`);
      const wrapped = ((((headingDeg ?? yaw) % 360) + 360) % 360).toFixed(1);
      write(heading.current, `${wrapped === "360.0" ? "0.0" : wrapped}°`);
      if (!amr) return;
      write(speed.current, `${speedValue.toFixed(1)} m/s`);
      write(
        status.current,
        agent
          ? (AGENT_LABELS[agent.state as keyof typeof AGENT_LABELS] ??
              String(agent.state))
          : "—",
      );
      write(battery.current, agent && batteryShown !== undefined ? `${batteryShown.toFixed(1)}%` : "—");
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
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
              <span ref={speed} className="tabular-nums">—</span>
            </dd>
          </div>
        </>
      )}
    </dl>
  );
}
