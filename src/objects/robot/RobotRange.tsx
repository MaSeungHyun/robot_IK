import { ROBOT_RANGE_STYLE } from "@/constants/simulatorLayout";

type Props = {
  reach: number;
  overlapping: boolean;
};

export default function RobotRange({ reach, overlapping }: Props) {
  const { width, opacity, fillOpacity, height, segments } = ROBOT_RANGE_STYLE;
  const color = overlapping ? ROBOT_RANGE_STYLE.overlapColor : ROBOT_RANGE_STYLE.color;

  return (
    <group position={[0, height, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh raycast={() => null}>
        <circleGeometry args={[reach - width, segments]} />
        <meshBasicMaterial color={color} transparent opacity={fillOpacity} depthWrite={false} />
      </mesh>

      <mesh raycast={() => null}>
        <ringGeometry args={[reach - width, reach, segments]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
    </group>
  );
}
