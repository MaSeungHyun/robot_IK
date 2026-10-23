import { Box3, Vector3 } from "three";
import type { Group } from "three";
import { createScannerModel } from "@/objects/scanner/scannerModel";
import { createUnitPallet } from "@/lib/three/modelNormalization";
import { translucentClone } from "@/lib/three/translucentClone";
import { poseRobotHome } from "@/domain/robot/ik/joints";
import { conveyorTemplate } from "@/objects/conveyor/conveyorTemplate";
import { STREAM_CONFIG } from "@/constants/simulation";
import { AMR_CONFIG } from "@/constants/amr";
import type { ConveyorTurn } from "@/types/layout";

export type GhostModelKind = "robot" | "pallet" | "amr" | "scanner" | "rack";

/** Translucent placement preview of a GLB-based asset. */
export function buildModelGhost(kind: GhostModelKind, scene: Group) {
  let model: Group;
  if (kind === "scanner") {
    const scanner = createScannerModel(scene);
    const ghost = translucentClone(scanner.model);
    scanner.dispose();
    return ghost;
  }

  if (kind === "pallet") {
    model = createUnitPallet(scene);
    model.scale.set(
      STREAM_CONFIG.palletWidth,
      STREAM_CONFIG.palletHeight,
      STREAM_CONFIG.palletDepth,
    );
  } else {
    model = scene.clone(true);
    if (kind === "robot") return translucentClone(poseRobotHome(model));
    else if (kind === "rack") return translucentClone(model);
    else {
      const bounds = new Box3().setFromObject(model),
        size = bounds.getSize(new Vector3());
      model.scale.multiplyScalar(AMR_CONFIG.bodyWidth / Math.max(size.x, size.z));
      bounds.setFromObject(model);
      const center = bounds.getCenter(new Vector3());
      model.position.sub(new Vector3(center.x, bounds.min.y, center.z));
    }
  }
  return translucentClone(model);
}

export function buildConveyorGhost(turn: ConveyorTurn = "straight") {
  return translucentClone(conveyorTemplate(turn));
}
