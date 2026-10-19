import { Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { SCANNER_CONFIG } from "@/constants/scanner";
import type { ScanResult } from "@/types/scanner";

export function createScannerModel(source: Group) {
  const model = new Group();
  const asset = source.clone(true);
  asset.scale.setScalar(SCANNER_CONFIG.scale);
  model.add(asset);

  const bounds = new Box3().setFromObject(model);
  asset.position.y -= bounds.min.y;
  model.updateMatrixWorld(true);

  const scanPoint = model.getObjectByName(SCANNER_CONFIG.scanPointName);
  if (!scanPoint) throw new Error("scanner.glb: ScanPoint가 없습니다.");

  const localPoint = model.worldToLocal(scanPoint.getWorldPosition(new Vector3()));
  const signals: { material: MeshStandardMaterial; color: MeshStandardMaterial["color"]; emissive: MeshStandardMaterial["emissive"] }[] = [];
  let halfWidth = 0;

  model.traverse((node) => {
    if (!(node instanceof Mesh)) return;

    const cloneSignal = (material: MeshStandardMaterial) => {
      if (material.name !== SCANNER_CONFIG.materialName) return material;
      if (!(material instanceof MeshStandardMaterial)) throw new Error("scanner.glb: gradient 재질 형식을 확인해 주세요.");

      const copy = material.clone();
      signals.push({ material: copy, color: copy.color.clone(), emissive: copy.emissive.clone() });
      node.geometry.computeBoundingBox();
      const size = node.geometry.boundingBox?.getSize(new Vector3());
      halfWidth = Math.max(halfWidth, (size?.x ?? 0) * SCANNER_CONFIG.scale / 2);
      return copy;
    };

    node.material = Array.isArray(node.material)
      ? node.material.map(cloneSignal)
      : cloneSignal(node.material);
  });

  if (!signals.length) throw new Error("scanner.glb: gradient 재질이 없습니다.");

  function setSignal(result: ScanResult | null, colors: Record<ScanResult, string>) {
    for (const signal of signals) {
      if (result) {
        signal.material.color.set(colors[result]);
        signal.material.emissive.set(colors[result]);
      } else {
        signal.material.color.copy(signal.color);
        signal.material.emissive.copy(signal.emissive);
      }
    }
  }

  return {
    model,
    localPoint,
    halfWidth,
    setSignal,
    dispose: () => signals.forEach(({ material }) => material.dispose()),
  };
}
