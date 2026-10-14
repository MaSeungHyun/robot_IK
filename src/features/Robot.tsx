import { MOTION, IK_CONFIG } from "./constants";
import type { PlanningEvent } from "./packingDiagnostics";
import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import { Group, Quaternion, Vector3, type Mesh } from "three";
import { createRobotIK, type IKPose } from "./robotIK";
import robot from "@/assets/models/robot.glb?url";

export type Transfer = {
  box: Group;
  pickup: Vector3;
  destination: Vector3;
  moving?: boolean;
  yaw?: number;
  velocity?: Vector3;
  onPick?: () => void;
  onPlace?: () => void;
  onMiss?: () => void;
  available?: () => boolean;
  replanPlacement?: (restart?: boolean) => boolean;
  advancePlacementLevel?: () => boolean;
  onPlanEvent?: (event: PlanningEvent) => void;
};
type Props = ThreeElements["group"] & {
  running: boolean;
  jobs: RefObject<Transfer[]>;
  onProgress: (completed: number, status: string) => void;
  geometryScale?: number;
  obstacles?: RefObject<Group[]>;
};
// Default Blender +Y-up export: Blender local +X -> glTF local +X.
export default function Robot({
  jobs,
  running,
  onProgress,
  geometryScale = 1,
  obstacles,
  ...props
}: Props) {
  const { scene } = useGLTF(robot);
  const model = useMemo(() => {
    const copy = scene.clone(true);
    if (geometryScale !== 1)
      copy.traverse((node) => {
        node.position.multiplyScalar(geometryScale);
        if ("geometry" in node) {
          const mesh = node as Mesh;
          mesh.geometry = mesh.geometry.clone();
          mesh.geometry.scale(geometryScale, geometryScale, geometryScale);
        }
      });
    return copy;
  }, [scene, geometryScale]);
  const ik = useMemo(
    () => createRobotIK(model, geometryScale),
    [model, geometryScale],
  );
  const ikRef = useRef(ik);
  const runtime = useRef({
    index: 0,
    stage: 0,
    target: new Vector3(),
    point: new Vector3(),
    quaternion: new Quaternion(),
    parent: null as Group | null,
    waypoints: [] as Vector3[],
    waypoint: 0,
    hold: 0,
    elapsed: 0,
    reported: false,
    pose: null as IKPose | null,
    planning: null as ReturnType<typeof ik.startPlan> | null,
    descentRotation: null as Quaternion | null,
    motionRetries: 0,
    tracking: 0,
    acquired: false,
    carryRotation: new Quaternion(),
    rotationPending: false,
    fullPlacement: false,
  });

  useFrame((_, delta) => {
    if (!running) return;
    const ik = ikRef.current;
    const r = runtime.current;
    const job = jobs.current[r.index];
    if (!job) return;
    const grip = ik.grip;
    const dt = Math.min(delta, MOTION.maxDelta);
    if (r.stage < 2 && job.available && !job.available()) {
      job.onMiss?.();
      r.index++;
      r.stage = 0;
      r.pose = null;
      r.planning = null;
      onProgress(r.index, "집기 범위를 지난 박스는 통과");
      return;
    }
    if (r.stage === 0) {
      r.waypoints = [
        job.pickup.clone().add(new Vector3(0, MOTION.approachHeight, 0)),
        job.pickup.clone(),
      ];
      r.waypoint = 0;
      r.target.copy(r.waypoints[0]);
      r.stage = 1;
      r.elapsed = 0;
      r.tracking = 0;
      r.acquired = false;
      r.motionRetries = 0;
      r.rotationPending = false;
      r.descentRotation = null;
      r.fullPlacement = false;
      r.reported = false;
      r.pose = null;
      r.planning = null;
      onProgress(r.index, "박스 접근 중");
    }
    r.carryRotation
      .copy(
        r.stage === 2 && r.waypoint === 2 && r.descentRotation
          ? r.descentRotation.clone().invert()
          : ik.carryRotation,
      )
      .multiply(
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), job.yaw ?? 0),
      );
    if (job.moving && r.stage === 1) {
      r.target.copy(job.pickup);
      if (r.waypoint === 0) r.target.y += MOTION.approachHeight;
      if (r.pose?.reachable && ik.isSettled(r.pose)) r.acquired = true;
      r.tracking += dt;
      if (
        r.tracking >=
          (r.pose?.reachable
            ? MOTION.trackingInterval
            : MOTION.retryInterval) &&
        (!r.pose?.reachable || r.acquired) &&
        (!r.pose?.route || ik.isSettled(r.pose))
      ) {
        r.pose = null;
        r.tracking = 0;
      }
    }
    ik.collisions.setContext({
      boxes: obstacles?.current ?? jobs.current.map((j) => j.box),
      active: job.box,
      carrying: r.stage === 2,
      releasing: r.stage === 3,
      carryRotation:
        r.stage === 2 && r.waypoint >= 1
          ? job.box.quaternion.clone()
          : undefined,
    });
    const nextPlacement = (reason = "현재 후보 경로 실패") => {
      job.onPlanEvent?.({
        state: "rejected",
        reason,
        phase: r.fullPlacement ? "precise" : "quick",
      });
      if (job.replanPlacement?.()) return true;
      if (!r.fullPlacement && job.replanPlacement) {
        r.fullPlacement = true;
        return job.replanPlacement(true);
      }
      if (job.advancePlacementLevel?.()) {
        r.fullPlacement = false;
        return true;
      }
      return false;
    };
    if (r.stage === 2 && r.waypoint >= 1) {
      const rotation = ik.collisions.orientCargo(r.carryRotation, dt);
      r.rotationPending = rotation !== "ready";
      if (rotation !== "ready") {
        if (rotation === "blocked" && !r.reported) {
          r.reported = true;
          onProgress(r.index, "자세 변경 여유를 확보하는 경로 탐색 중");
        }
        if (rotation === "moving") return;
      }
    }
    if (!r.pose) {
      if (
        !r.planning &&
        r.stage === 2 &&
        r.waypoint >= 1 &&
        !ik.collisions.placementClear(
          job.destination,
          job.yaw ?? 0,
          r.waypoints[1].y,
          ik.carryRotation.clone().invert(),
        )
      ) {
        if (nextPlacement("박스 하강 영역에 적재 박스·팔레트 간섭")) {
          const tip = job.destination
            .clone()
            .sub(
              job.box.position
                .clone()
                .multiply(grip.getWorldScale(new Vector3()))
                .applyQuaternion(ik.carryRotation.clone().invert()),
            );
          r.waypoints[1] = tip
            .clone()
            .setY(
              Math.min(
                ik.collisions.liftHeight(job.destination.y),
                job.destination.y + MOTION.destinationHoverClearance,
              ),
            );
          r.waypoints[2] = tip;
          r.waypoint = 1;
          r.target.copy(r.waypoints[1]);
          onProgress(r.index, "그리퍼 하강 공간 확보 · 다른 후보 검사");
        } else {
          r.pose = {
            angles: ik.controls.map((c) => c.angle),
            rail: 0,
            error: Infinity,
            reachable: false,
          };
          onProgress(r.index, "박스·그리퍼가 내려갈 공간 부족");
        }
        return;
      }
      // Align wrist above cargo at the destination hover point, then keep
      // the same downward gripper orientation throughout final lowering.
      const predictedTarget = r.target.clone();
      if (job.moving && r.stage === 1 && job.velocity)
        predictedTarget.addScaledVector(job.velocity, MOTION.predictionSeconds);
      // Finish alternate bends and collision-free routes at this footprint first.
      if (r.stage === 2 && r.waypoint >= 1) r.fullPlacement = true;
      const fastPlacement = false;
      if (!r.planning) {
        job.onPlanEvent?.({
          state: "searching",
          reason:
            r.stage === 1
              ? "박스 집기 경로 검사"
              : r.stage === 3
                ? "손 빼는 경로 검사"
                : "선택 후보의 관절·운반 박스 경로 검사",
          phase: r.fullPlacement ? "precise" : "quick",
        });
        r.planning = ik.startPlan(
          predictedTarget,
          (r.stage === 2 && r.waypoint >= 1) ||
            r.stage === 3 ||
            Boolean(job.moving && r.stage === 1),
          Boolean(job.moving && r.stage === 1 && r.acquired),
          Boolean(job.moving),
          fastPlacement,
          r.stage === 2 && r.waypoint === 2
            ? (r.descentRotation ?? undefined)
            : undefined,
        );
      }
      r.pose = ik.advancePlan(
        r.planning,
        IK_CONFIG.planningBudgetMs,
        job.moving ? IK_CONFIG.movingPlanWorkLimitMs : Infinity,
      );
      if (!r.pose) return;
      if (r.pose.reason === "timeout") {
        if (
          r.stage === 2 &&
          r.waypoint >= 1 &&
          !r.fullPlacement &&
          nextPlacement("빠른 탐색의 계산 시간 예산 초과 · 정밀 재검사 대상")
        ) {
          const tip = job.destination
            .clone()
            .sub(
              job.box.position
                .clone()
                .multiply(grip.getWorldScale(new Vector3()))
                .applyQuaternion(ik.carryRotation.clone().invert()),
            );
          r.waypoints[1] = tip
            .clone()
            .setY(
              Math.min(
                ik.collisions.liftHeight(job.destination.y),
                job.destination.y + MOTION.destinationHoverClearance,
              ),
            );
          r.waypoints[2] = tip;
          r.waypoint = 1;
          r.target.copy(r.waypoints[1]);
          r.pose = null;
          r.planning = null;
          onProgress(r.index, "시간 예산 내 경로 미완성 · 다른 적재 위치 탐색");
          return;
        }
        r.pose = null;
        onProgress(r.index, "경로 탐색 계속 중 · 계산을 다음 프레임으로 분산");
        return;
      }
      r.planning = null;
      if (!r.pose.reachable) {
        if (
          r.stage === 2 &&
          r.waypoint >= 1 &&
          nextPlacement(
            r.pose.blockedBy ??
              `IK 위치 오차 ${Number.isFinite(r.pose.error) ? r.pose.error.toFixed(3) : "미수렴"}m`,
          )
        ) {
          const tip = job.destination
            .clone()
            .sub(
              job.box.position
                .clone()
                .multiply(grip.getWorldScale(new Vector3()))
                .applyQuaternion(ik.carryRotation.clone().invert()),
            );
          r.waypoints[1] = tip
            .clone()
            .setY(
              Math.min(
                ik.collisions.liftHeight(job.destination.y),
                job.destination.y + MOTION.destinationHoverClearance,
              ),
            );
          r.waypoints[2] = tip;
          r.waypoint = 1;
          r.target.copy(r.waypoints[1]);
          r.pose = null;
          onProgress(r.index, "충돌 없는 적재 위치 재탐색 중");
          return;
        }
        if (job.moving && r.stage === 1) r.acquired = false;
        onProgress(
          r.index,
          `안전한 경로 없음 · ${ik.collisions.lastHit ?? "관절 도달 범위·손끝 자세 조건"}`,
        );
      }
      if (r.pose.reachable && r.stage === 2 && r.waypoint >= 1)
        job.onPlanEvent?.({
          state: "ready",
          reason: "현재 구간의 안전한 경로 확인",
          phase: r.fullPlacement ? "precise" : "quick",
        });
    }
    if (!r.pose.reachable) return;
    if (!ik.animate(r.pose, dt)) {
      if (
        r.stage === 2 &&
        r.waypoint >= 1 &&
        ++r.motionRetries >= MOTION.maxPlacementMotionRetries
      ) {
        const reason = `같은 구간 실행 충돌 반복 · ${ik.collisions.lastHit ?? "자세 변화"}`;
        if (nextPlacement(reason)) {
          const tip = job.destination
            .clone()
            .sub(
              job.box.position
                .clone()
                .multiply(grip.getWorldScale(new Vector3()))
                .applyQuaternion(ik.carryRotation.clone().invert()),
            );
          r.waypoints[1] = tip
            .clone()
            .setY(
              Math.min(
                ik.collisions.liftHeight(job.destination.y),
                job.destination.y + MOTION.destinationHoverClearance,
              ),
            );
          r.waypoints[2] = tip;
          r.waypoint = 1;
          r.target.copy(r.waypoints[1]);
          r.motionRetries = 0;
          r.pose = null;
          r.planning = null;
          onProgress(r.index, "실행 충돌 반복 · 다음 후보 검사");
          return;
        }
        r.pose.reachable = false;
        onProgress(
          r.index,
          `후보 검사 완료 · 안전한 실행 경로 미발견 · ${reason}`,
        );
        return;
      }

      job.onPlanEvent?.({
        state: "searching",
        reason: `실행 중 경로 재검사 · ${ik.collisions.lastHit ?? "상태 변화"}`,
        phase: r.fullPlacement ? "precise" : "quick",
      });
      if (!r.reported) {
        onProgress(
          r.index,
          `이동 경로 재탐색 · ${ik.collisions.lastHit ?? "장애물 위치 변화"}`,
        );
        r.reported = true;
      }
      r.pose = null;
      r.planning = null;
      r.acquired = false;
      return;
    }
    if (r.stage === 2) {
      // Lift upright first; then cargo follows the gripper during bends and
      // returns upright at the downward-oriented destination pose.
      grip.getWorldQuaternion(r.quaternion).invert();
      if (r.waypoint >= 1 && !r.rotationPending)
        job.box.quaternion.copy(r.carryRotation);
      else if (r.waypoint >= 1) ik.collisions.syncHeld();
      else job.box.quaternion.copy(r.quaternion);
    }
    r.elapsed += dt;
    if (
      grip.getWorldPosition(r.point).distanceTo(r.target) >
        MOTION.contactTolerance ||
      !ik.isSettled(r.pose)
    ) {
      r.hold = 0;
      if (r.elapsed > MOTION.approachTimeout && !r.reported) {
        onProgress(r.index, "목표에 접근 중 · 관절 도달 범위 확인 필요");
        r.reported = true;
      }
      return;
    }
    r.hold += dt;
    if (
      r.hold <
      (job.moving && r.stage === 1
        ? MOTION.movingContactHold
        : MOTION.contactHold)
    )
      return;
    r.hold = 0;
    r.elapsed = 0;
    r.reported = false;
    r.pose = null;
    if (r.stage === 2 && r.waypoint === 1) {
      // Rotate to the final box yaw while still above the destination. Keep
      // this tool orientation throughout lowering; shoulder/elbow solve XYZ.
      r.descentRotation = grip.getWorldQuaternion(new Quaternion());
      const offset = job.box.position
        .clone()
        .multiply(grip.getWorldScale(new Vector3()))
        .applyQuaternion(r.descentRotation);
      r.waypoints[2] = job.destination.clone().sub(offset);
      onProgress(r.index, "상부에서 방향 맞춤 · 방향 유지하며 하강");
    }
    r.waypoint++;
    r.motionRetries = 0;
    if (job.moving && r.stage === 1) r.acquired = false;
    if (r.waypoint < r.waypoints.length) {
      r.target.copy(r.waypoints[r.waypoint]);
      return;
    }
    if (r.stage === 3) {
      job.onPlace?.();
      r.index++;
      r.stage = 0;
      onProgress(r.index, "적재 완료 · 다음 박스 준비 중");
    } else if (r.stage === 1) {
      r.parent = job.box.parent as Group;
      // Attach only at contact. Align the normalized box top with GripPoint.
      grip.attach(job.box);
      job.onPick?.();
      // Preserve contact pose: snapping cargo to an approximate IK point
      // can push it into the wrist immediately after a valid pickup.
      const clearance = job.moving
        ? ik.collisions.liftHeight(job.destination.y)
        : Math.max(
            ...jobs.current.map((j) => Math.max(j.pickup.y, j.destination.y)),
          ) + MOTION.liftClearance;
      // Contact may be off-center while tracking a moving box. Compensate
      // that attachment offset so the cargo, rather than the tip, lands
      // at the reserved packing position.
      const placementTip = job.destination
        .clone()
        .sub(
          job.box.position
            .clone()
            .multiply(grip.getWorldScale(new Vector3()))
            .applyQuaternion(ik.carryRotation.clone().invert()),
        );
      r.waypoints = [
        job.pickup.clone().setY(clearance),
        placementTip
          .clone()
          .setY(
            job.moving
              ? Math.min(
                  clearance,
                  job.destination.y + MOTION.destinationHoverClearance,
                )
              : clearance,
          ),
        placementTip,
      ];
      r.waypoint = 0;
      r.target.copy(r.waypoints[0]);
      r.stage = 2;
      onProgress(r.index, "박스 운반 및 적재 중");
    } else {
      // Validate the exact reserved cargo transform before detaching.
      // Snapping to it must not bypass the sampled collision checks.
      const previousPosition = job.box.position.clone();
      const previousRotation = job.box.quaternion.clone();
      job.box.position.copy(grip.worldToLocal(job.destination.clone()));
      job.box.quaternion
        .copy(grip.getWorldQuaternion(r.quaternion).invert())
        .multiply(
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), job.yaw ?? 0),
        );
      ik.collisions.setContext({
        boxes: obstacles?.current ?? jobs.current.map((j) => j.box),
        active: job.box,
        carrying: true,
        carryRotation: job.box.quaternion.clone(),
      });
      if (ik.collisions.collision()) {
        job.box.position.copy(previousPosition);
        job.box.quaternion.copy(previousRotation);
        job.box.updateWorldMatrix(true, true);
        r.waypoint = r.waypoints.length - 1;
        if (nextPlacement(`최종 배치 간섭 · ${ik.collisions.lastHit}`)) {
          const tip = job.destination
            .clone()
            .sub(
              job.box.position
                .clone()
                .multiply(grip.getWorldScale(new Vector3()))
                .applyQuaternion(ik.carryRotation.clone().invert()),
            );
          r.waypoints[1] = tip
            .clone()
            .setY(
              Math.min(
                ik.collisions.liftHeight(job.destination.y),
                job.destination.y + MOTION.destinationHoverClearance,
              ),
            );
          r.waypoints[2] = tip;
          r.waypoint = 1;
          r.target.copy(r.waypoints[1]);
          r.pose = null;
          r.planning = null;
          onProgress(r.index, "최종 배치 간섭 · 다른 적재 위치 탐색");
        } else
          onProgress(r.index, `최종 배치 위치 충돌 · ${ik.collisions.lastHit}`);
        return;
      }
      r.parent!.attach(job.box);
      job.box.position.copy(r.parent!.worldToLocal(job.destination.clone()));
      job.box.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), job.yaw ?? 0);
      {
        r.stage = 3;
        r.waypoints = [
          job.destination
            .clone()
            .add(new Vector3(0, MOTION.retreatHeight * geometryScale, 0)),
        ];
        r.waypoint = 0;
        r.target.copy(r.waypoints[0]);
        onProgress(r.index, "적재 후 손 빼는 중");
      }
    }
  });
  return (
    <group {...props}>
      <primitive object={model} />
    </group>
  );
}
