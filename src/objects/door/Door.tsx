import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DOOR_CONFIG } from "@/constants/door";
import { useSceneStore } from "@/stores/useSceneStore";
import { createDoorModel } from "@/objects/door/doorModel";

/** Roller-shutter door: geometry rebuilt only on size changes; open/close animates over DOOR_CONFIG.travelSeconds. */
export default function Door({ id, simOpening }: { id: string; /** Simulation-driven opening 0..1 (forklift passing); shown when wider than the manual state. */ simOpening?: () => number }) {
  const width = useSceneStore((state) => state.settings[id]?.doorWidth ?? DOOR_CONFIG.width);
  const height = useSceneStore((state) => state.settings[id]?.doorHeight ?? DOOR_CONFIG.height);
  const open = useSceneStore((state) => state.settings[id]?.doorOpen === true);
  const model = useMemo(() => createDoorModel(width, height), [width, height]);
  const fraction = useRef<number | null>(null);
  const shown = useRef<number | null>(null);
  useEffect(() => () => model.dispose(), [model]);
  useEffect(() => {
    // New geometry starts where the previous one was (or at the target on first mount).
    if (fraction.current === null) fraction.current = open ? 1 : 0;
    shown.current = Math.max(fraction.current, simOpening?.() ?? 0);
    model.setOpen(shown.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on rebuild
  }, [model]);
  useFrame((_, delta) => {
    const target = open ? 1 : 0, current = fraction.current ?? target;
    if (current !== target) {
      const step = Math.min(delta, 0.1) / DOOR_CONFIG.travelSeconds;
      fraction.current = target > current ? Math.min(target, current + step) : Math.max(target, current - step);
    }
    const next = Math.max(fraction.current ?? target, simOpening?.() ?? 0);
    if (next === shown.current) return;
    shown.current = next;
    model.setOpen(next);
  });
  return <primitive object={model.group} dispose={null} />;
}