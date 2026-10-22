import { useLayoutEffect, useRef } from "react";
import { InstancedMesh, Object3D, Vector3 } from "three";
import { FACTORY_ROOM } from "@/constants/factoryRoom";

export type RoomBeam = {
  from: [number, number, number];
  to: [number, number, number];
  thickness: number;
};

/** All members in a frame share one box geometry/material and one draw call. */
export default function RoomFrame({ beams, color = FACTORY_ROOM.steelColor, metalness = 0.5 }: { beams: RoomBeam[]; color?: string; metalness?: number }) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const transform = new Object3D();
    const from = new Vector3(), to = new Vector3(), direction = new Vector3();
    const up = new Vector3(0, 1, 0);
    beams.forEach((beam, index) => {
      from.fromArray(beam.from);
      to.fromArray(beam.to);
      direction.subVectors(to, from);
      transform.position.copy(from).add(to).multiplyScalar(0.5);
      transform.scale.set(beam.thickness, direction.length(), beam.thickness);
      transform.quaternion.setFromUnitVectors(up, direction.normalize());
      transform.updateMatrix();
      mesh.current!.setMatrixAt(index, transform.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [beams]);
  return (
    <instancedMesh key={beams.length} ref={mesh} args={[undefined, undefined, beams.length]} raycast={() => {}}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={0.4} />
    </instancedMesh>
  );
}
