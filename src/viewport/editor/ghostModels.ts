import { Box3, Vector3 } from "three";
import type { Group } from "three";
import { createScannerModel } from "@/objects/scanner/scannerModel";
import { createUnitPallet } from "@/lib/three/modelNormalization";
import { translucentClone } from "@/lib/three/translucentClone";
import { poseRobotHome } from "@/domain/robot/ik/joints";
import { conveyorTemplate } from "@/objects/conveyor/conveyorTemplate";
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
  } else {
    model = scene.clone(true);
    if (kind === "robot") return translucentClone(poseRobotHome(model));
    else if (kind === "rack") return translucentClone(model);
    else {
      const bounds = new Box3().setFromObject(model);
      const center = bounds.getCenter(new Vector3());
      model.position.sub(new Vector3(center.x, bounds.min.y, center.z));
    }
  }
  return translucentClone(model);
}

export function buildConveyorGhost(turn: ConveyorTurn = "straight", rail?: Group) {
  return translucentClone(conveyorTemplate(turn, rail));
}
