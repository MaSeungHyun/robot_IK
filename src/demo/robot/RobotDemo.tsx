import type {
  Transfer,
  RobotTransferMode,
  JointAngleRef,
} from "@/types/robot";
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { Group, Vector3 } from "three";
import {
  BOX_SIZES,
  STREAM_CONFIG,
  ROBOT_PICKING,
} from "@/constants/simulation";
import { createUnitBox, createUnitPallet } from "@/utils/three/modelNormalization";
import Robot from "@/features/Viewport/models/Robot";
import { planStack } from "@/utils/packing/stacking";
import boxUrl from "@/assets/models/box.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";

export const BOX_COUNT = 60;
export const ROBOT_SCALE = 0.7;

export default function RobotDemo({
  transferMode,
  running,
  onProgress,
  jointAnglesRef,
}: {
  transferMode?: RobotTransferMode;
  running: boolean;
  jointAnglesRef?: JointAngleRef;
  onProgress: (count: number, status: string) => void;
}) {
  const boxAsset = useGLTF(boxUrl);
  const palletAsset = useGLTF(palletUrl);
  const jobs = useRef<Transfer[]>([]);
  const demo = useMemo(() => {
    const root = new Group();
    const palletTemplate = createUnitPallet(palletAsset.scene);
    const palletSize = new Vector3(
      STREAM_CONFIG.palletWidth,
      STREAM_CONFIG.palletHeight,
      STREAM_CONFIG.palletDepth,
    );
    palletTemplate.scale.copy(palletSize);
    const centers = [new Vector3(1.15, 0, 0), STREAM_CONFIG.center.clone()];
    centers.forEach((center) => {
      const pallet = new Group();
      pallet.position.copy(center);
      pallet.add(palletTemplate.clone(true));
      root.add(pallet);
    });
    const template = createUnitBox(boxAsset.scene);
    const size = BOX_SIZES[0];
    template.scale.copy(size);
    const plan = planStack(BOX_COUNT, palletSize, size, 0);
    const transfers: Transfer[] = [];
    const sourcePositions = plan.slots.map((slot) =>
      slot.position
        .clone()
        .add(centers[0])
        .add(new Vector3(0, palletSize.y + size.y, 0)),
    );
    // Remove the top layer first, then the lower layer. Destination fills
    // from the center outward and finishes each layer before starting another.
    const order = plan.slots
      .map((slot, i) => ({ layer: slot.layer, i }))
      .sort((a, b) => b.layer - a.layer || a.i - b.i);
    order.forEach(({ i }, destinationIndex) => {
      const cargo = new Group();
      // Rotate around the normalized top-center pivot.
      const pivot = new Group();
      pivot.add(template.clone(true));
      pivot.rotation.y = plan.rotated ? Math.PI / 2 : 0;
      cargo.add(pivot);
      cargo.position.copy(sourcePositions[i]);
      root.add(cargo);
      transfers.push({
        yaw: 0,
        box: cargo,
        pickup: sourcePositions[i],
        destination: plan.slots[destinationIndex].position
          .clone()
          .add(centers[1])
          .add(new Vector3(0, palletSize.y + size.y, 0)),
      });
    });
    return { root, transfers };
  }, [boxAsset.scene, palletAsset.scene]);
  useEffect(() => {
    jobs.current = demo.transfers;
    return () => {
      jobs.current = [];
    };
  }, [demo]);
  return (
    <>
      <primitive object={demo.root} />
      <Robot
        geometryScale={ROBOT_SCALE}
        pickupRadius={
          ROBOT_PICKING.radius * STREAM_CONFIG.robotScale +
          STREAM_CONFIG.palletWidth / 4
        }
        transferMode={transferMode}
        jointAnglesRef={jointAnglesRef}
        jobs={jobs}
        running={running}
        onProgress={onProgress}
      />
    </>
  );
}
