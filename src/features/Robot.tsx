import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import { Group, Quaternion, Vector3 } from "three";
import { createRobotIK, type IKPose } from "./robotIK";
import robot from "@/assets/models/gripper_robot.glb?url";

export type Transfer = { box: Group; pickup: Vector3; destination: Vector3 };
type Props = ThreeElements["group"] & {
  running: boolean;
  jobs: RefObject<Transfer[]>;
  onProgress: (completed: number, status: string) => void;
};
// Default Blender +Y-up export: Blender local +X -> glTF local +X.
export default function Robot({ jobs, running, onProgress, ...props }: Props) {
  const { scene } = useGLTF(robot);
  const model = useMemo(() => scene.clone(true), [scene]);
  const ik = useMemo(() => createRobotIK(model), [model]);
  const ikRef = useRef(ik);
  const runtime = useRef({
    index: 0, stage: 0, target: new Vector3(), point: new Vector3(),
    quaternion: new Quaternion(), 
    parent: null as Group | null,
    waypoints: [] as Vector3[], waypoint: 0, hold: 0, elapsed: 0, reported: false,
    pose: null as IKPose | null,
  });

  useFrame((_, delta) => {
    if (!running) return;
    const ik = ikRef.current;
    const r = runtime.current;
    const job = jobs.current[r.index];
    if (!job) return;
    const grip = ik.grip;
    const dt = Math.min(delta, 0.05);
    if (r.stage === 0) {
      r.waypoints = [job.pickup.clone().add(new Vector3(0, 0.18, 0)), job.pickup.clone()];
      r.waypoint = 0;
      r.target.copy(r.waypoints[0]);
      r.stage = 1;
      r.elapsed = 0;
      r.reported = false;
      r.pose = null;
      onProgress(r.index, "박스 접근 중");
    }
    ik.collisions.setContext({ boxes: jobs.current.map(j => j.box), active: job.box, carrying: r.stage === 2,
      carryRotation: r.stage === 2 && r.waypoint >= 1 ? job.box.quaternion.clone() : undefined });
    if (r.stage === 2 && r.waypoint >= 1) {
      const rotation = ik.collisions.orientCargo(ik.carryRotation, dt);
      if (rotation !== "ready") {
        if (rotation === "blocked" && !r.reported) {
          r.reported = true;
          onProgress(r.index, "박스 자세 변경 중 충돌 위험 · 정지");
        }
        return;
      }
    }
    if (!r.pose) {
      // Align wrist above cargo at the destination hover point, then keep
      // the same downward gripper orientation throughout final lowering.
      r.pose = ik.plan(r.target, r.stage === 2 && r.waypoint >= 1);
      if (!r.pose.reachable) {
        onProgress(r.index, "관절 제한·충돌 여유를 지키는 경로 없음 · 정지");
      }
    }
    if (!r.pose.reachable) return;
    if (!ik.animate(r.pose, dt)) {
      onProgress(r.index, "충돌 위험으로 이동 정지");
      return;
    }
    if (r.stage === 2) {
      // Vacuum-gripper demo: keep cargo upright while its position follows GripPoint.
      grip.getWorldQuaternion(r.quaternion).invert();
      if (r.waypoint >= 1) job.box.quaternion.copy(ik.carryRotation);
      else job.box.quaternion.copy(r.quaternion);
    }
    r.elapsed += dt;
    if (grip.getWorldPosition(r.point).distanceTo(r.target) > 0.025 || !ik.isSettled(r.pose)) {
      r.hold = 0;
      if (r.elapsed > 15 && !r.reported) {
        onProgress(r.index, "목표에 접근 중 · 관절 도달 범위 확인 필요");
        r.reported = true;
      }
      return;
    }
    r.hold += dt;
    if (r.hold < 0.15) return;
    r.hold = 0;
    r.elapsed = 0;
    r.reported = false;
    r.pose = null;
    r.waypoint++;
    if (r.waypoint < r.waypoints.length) {
      r.target.copy(r.waypoints[r.waypoint]);
      return;
    }
    if (r.stage === 1) {
      r.parent = job.box.parent as Group;
      // Attach only at contact. Align the normalized box top with GripPoint.
      grip.attach(job.box);
      // Preserve contact pose: snapping cargo to an approximate IK point
      // can push it into the wrist immediately after a valid pickup.
      const clearance = Math.max(...jobs.current.map(j => Math.max(j.pickup.y, j.destination.y))) + 0.65;
      r.waypoints = [
        job.pickup.clone().setY(clearance),
        job.destination.clone().setY(clearance),
        job.destination.clone(),
      ];
      r.waypoint = 0;
      r.target.copy(r.waypoints[0]);
      r.stage = 2;
      onProgress(r.index, "박스 운반 및 적재 중");
    } else {
      r.parent!.attach(job.box);
      job.box.position.copy(r.parent!.worldToLocal(job.destination.clone()));
      job.box.quaternion.identity();
      r.index++;
      r.stage = 0;
      onProgress(r.index, r.index === jobs.current.length ? "적재 완료" : "다음 박스 준비 중");
    }
  });
  return <group {...props}><primitive object={model} /></group>;
}




