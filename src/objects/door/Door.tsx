import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DOOR_CONFIG } from "@/constants/door";
import { useSceneStore } from "@/stores/useSceneStore";
import { createDoorModel } from "@/objects/door/doorModel";

/** Roller-shutter door: geometry rebuilt only on size changes; open/close animates over DOOR_CONFIG.travelSeconds. */
export default function Door({ id }: { id: string }) {
  const width = useSceneStore((state) => state.settings[id]?.doorWidth ?? DOOR_CONFIG.width);
  const height = useSceneStore((state) => state.settings[id]?.doorHeight ?? DOOR_CONFIG.height);
  const open = useSceneStore((state) => state.settings[id]?.doorOpen === true);
  const model = useMemo(() => createDoorModel(width, height), [width, height]);
  const fraction = useRef<number | null>(null);
  useEffect(() => () => model.dispose(), [model]);
  useEffect(() => {
    // New geometry starts where the previous one was (or at the target on first mount).
    if (fraction.current === null) fraction.current = open ? 1 : 0;
    model.setOpen(fraction.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on rebuild
  }, [model]);
  useFrame((_, delta) => {
    const target = open ? 1 : 0, current = fraction.current ?? target;
    if (current === target) return;
    const step = Math.min(delta, 0.1) / DOOR_CONFIG.travelSeconds;
    fraction.current = target > current ? Math.min(target, current + step) : Math.max(target, current - step);
    model.setOpen(fraction.current);
  });
  return <primitive object={model.group} dispose={null} />;
}