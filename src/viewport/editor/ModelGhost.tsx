import scannerUrl from "@/assets/models/scanner.glb?url";
import { createScannerModel } from "@/objects/scanner/scannerModel";
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { Box3, Vector3 } from "three";
import type { Group } from "three";
import { createUnitPallet } from "@/lib/three/modelNormalization";
import { translucentClone } from "@/lib/three/translucentClone";
import { SIMULATOR_CONFIG as C } from "@/constants/simulatorLayout";
import { STREAM_CONFIG } from "@/constants/simulation";
import { AMR_CONFIG } from "@/constants/amr";
import robotUrl from "@/assets/models/robot.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";
import amrUrl from "@/assets/models/amr.glb?url";
import rackUrl from "@/assets/models/rack.glb?url";

export default function ModelGhost({ kind }: { kind: "robot" | "pallet" | "amr" | "scanner" | "rack" }) {
  const { scene } = useGLTF(
    kind === "robot" ? robotUrl : kind === "pallet" ? palletUrl : kind === "scanner" ? scannerUrl : kind === "rack" ? rackUrl : amrUrl,
  );
  const ghost = useMemo(() => {
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
      if (kind === "robot") model.scale.multiplyScalar(C.robotScale);
      else if (kind === "rack") return translucentClone(model);
      else {
        const bounds = new Box3().setFromObject(model),
          size = bounds.getSize(new Vector3());
        model.scale.multiplyScalar(
          AMR_CONFIG.bodyWidth / Math.max(size.x, size.z),
        );
        bounds.setFromObject(model);
        const center = bounds.getCenter(new Vector3());
        model.position.sub(new Vector3(center.x, bounds.min.y, center.z));
      }
    }
    return translucentClone(model);
  }, [scene, kind]);

  useEffect(() => ghost.dispose, [ghost]);

  return <primitive object={ghost.model} dispose={null} />;
}
