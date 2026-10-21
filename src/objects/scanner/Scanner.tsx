import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import scannerUrl from "@/assets/models/scanner.glb?url";
import { SCANNER_CONFIG } from "@/constants/scanner";
import type { ScannerInspection } from "@/domain/scanner/ScannerInspection";
import type { SceneEquipment } from "@/types/layout";
import type { ScanResult } from "@/types/scanner";
import { createScannerModel } from "@/objects/scanner/scannerModel";

type Props = { entity: SceneEquipment; inspection?: ScannerInspection };

export default function Scanner({ entity, inspection }: Props) {
  const { scene } = useGLTF(scannerUrl);
  const scanner = useMemo(() => createScannerModel(scene), [scene]);
  const lastResult = useRef<ScanResult | null>(null);
  const colors = useRef<Record<ScanResult, string>>({ safe: "", fault: "" });

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    colors.current = {
      safe: style.getPropertyValue(SCANNER_CONFIG.safeToken).trim(),
      fault: style.getPropertyValue(SCANNER_CONFIG.faultToken).trim(),
    };
    if (!colors.current.safe || !colors.current.fault) throw new Error("safe/fault 테마 색상을 확인해 주세요.");

    return () => scanner.dispose();
  }, [scanner]);

  useEffect(() => {
    if (!inspection) return;

    const point = scanner.localPoint.clone().applyAxisAngle(new Vector3(0, 1, 0), entity.yaw);
    point.x += entity.x;
    point.z += entity.z;

    return inspection.register(entity.id, {
      point,
      normal: new Vector3(Math.sin(entity.yaw), 0, Math.cos(entity.yaw)),
      halfWidth: scanner.halfWidth,
      floor: 0,
    });
  }, [inspection, entity.id, entity.x, entity.z, entity.yaw, scanner]);

  useFrame(() => {
    const result = inspection?.getSignal(entity.id) ?? null;
    if (lastResult.current === result) return;

    scanner.setSignal(result, colors.current);
    lastResult.current = result;
  });

  return <primitive object={scanner.model} dispose={null} />;
}
