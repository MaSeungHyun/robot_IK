import { Html, Line } from "@react-three/drei";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import Button from "@/components/Button";
import { useSceneStore } from "@/stores/useSceneStore";
import type { ConveyorTurn, SceneEquipment } from "@/types/layout";
import {
  beltConnections,
  beltLength,
  beltLocalPoint,
  extendBelt,
} from "@/domain/conveyor/conveyorLayout";
import ConveyorGhost from "@/viewport/editor/ConveyorGhost";
import { scannerOutletTaken } from "@/domain/conveyor/scannerBelt";
import { SCAN_TUNNEL_MODEL } from "@/constants/modelPoints.generated";
import { CONVEYOR_LAYOUT } from "@/constants/conveyorLayoutConfig";

/** Direction buttons at a conveyor end or a scanner's tunnel exit: add a rail.glb (native length) there. */
export default function ConveyorExtensionControls({ entity }: { entity: SceneEquipment }) {
  const scanner = entity.kind === "scanner";
  const length = beltLength(entity),
    turn = entity.conveyorTurn;
  const [hover, setHover] = useState<ConveyorTurn | null>(null);
  const points = useMemo(
    () =>
      Array.from({ length: 41 }, (_, i) => {
        const p = beltLocalPoint(entity, (length * i) / 40);
        return [p.x, 0.256, p.z] as [number, number, number];
      }),
    [length, turn],
  );
  const { selected, connected, extend } = useSceneStore(
    useShallow((state) => ({
      selected: state.editing && state.selected === entity.id,
      connected:
        state.selected === entity.id &&
        (scanner
          ? scannerOutletTaken(entity, state.objects)
          : beltConnections(state.objects).next.has(entity.id)),
      extend: state.extendConveyor,
    })),
  );
  const end = scanner
    ? { x: 0, z: SCAN_TUNNEL_MODEL.beltZ[1], yaw: 0 }
    : beltLocalPoint(entity, length);
  const extension = !hover
    ? null
    : scanner
      ? { x: 0, z: end.z + CONVEYOR_LAYOUT.length / 2, yaw: 0 }
      : extendBelt({ x: 0, z: 0, yaw: 0, conveyorTurn: turn }, hover);
  const directions: {
    turn: ConveyorTurn;
    label: string;
    symbol: string;
    x: number;
    z: number;
  }[] = [
    {
      turn: "left",
      label: "왼쪽 곡선 컨베이어 추가",
      symbol: "←",
      x: -0.65,
      z: 0,
    },
    {
      turn: "straight",
      label: "직선 컨베이어 추가",
      // The button lies on XZ: screen-down in its local plane points along +Z.
      symbol: "↓",
      x: 0,
      z: 0.5,
    },
    {
      turn: "right",
      label: "오른쪽 곡선 컨베이어 추가",
      symbol: "→",
      x: 0.65,
      z: 0,
    },
  ];
  return (
    <group userData={{ noOutline: true }}>
      {selected && !scanner && <Line points={points} color="#02dfef" lineWidth={3} />}
      {selected && !connected && hover && extension && (
        <group
          position={[extension.x, 0, extension.z]}
          rotation={[0, extension.yaw, 0]}
        >
          <ConveyorGhost turn={hover} />
        </group>
      )}
      {selected && (
        <group position={[end.x, 0.28, end.z]} rotation={[0, end.yaw, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.065, 20]} />
            <meshBasicMaterial color="#02dfef" />
          </mesh>
          {!connected &&
            directions.map((direction) => (
              <Html
                key={direction.turn}
                position={[direction.x, 0.05, direction.z]}
                transform
                rotation={[-Math.PI / 2, 0, 0]}
                distanceFactor={3.2}
                center
                zIndexRange={[30, 20]}
              >
                <Button
                  aria-label={direction.label}
                  title={direction.label}
                  className="aspect-square w-10 h-10 gap-1 rounded-full border border-sky-200/50 px-3 shadow-lg bg-sky-400/50"
                  onPointerEnter={() => setHover(direction.turn)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(direction.turn)}
                  onBlur={() => setHover(null)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setHover(null);
                    extend(entity.id, direction.turn);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="text-2xl font-bold text-white h-full w-full flex items-center justify-center"
                  >
                    {direction.symbol}
                  </span>
                </Button>
              </Html>
            ))}
        </group>
      )}
    </group>
  );
}
