import { Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { SCANNER_CONFIG } from "@/constants/scanner";
import { SCAN_TUNNEL } from "@/domain/conveyor/scanTunnel";
import type { ScanResult } from "@/types/scanner";

/** ScanTunnel.glb as authored: mesh pivot moved to the scanner origin, exit belt on the rail belt (see scanTunnel.ts). */
export function createScannerModel(source: Group) {
  const model = new Group();
  const asset = source.clone(true);
  for (const child of asset.children) child.position.set(0, 0, 0);
  asset.position.y = SCAN_TUNNEL.lift;
  model.add(asset);
  model.updateMatrixWorld(true);

  const scanPoint = model.getObjectByName(SCANNER_CONFIG.scanPointName);
  // Re-exported glb may lack the empty: fall back to the model origin (its pivot, Y included) and warn instead of throwing.
  let world: Vector3;
  if (scanPoint) world = scanPoint.getWorldPosition(new Vector3());
  else {
    console.warn(`ScanTunnel.glb: ${SCANNER_CONFIG.scanPointName} 없음 - 모델 원점을 스캔 기준점으로 사용`);
    world = (asset.children[0] ?? asset).getWorldPosition(new Vector3());
  }
  const localPoint = model.worldToLocal(world);
  const signals: { material: MeshStandardMaterial; color: MeshStandardMaterial["color"]; emissive: MeshStandardMaterial["emissive"] }[] = [];

  model.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const cloneSignal = (material: MeshStandardMaterial) => {
      if (material.name !== SCANNER_CONFIG.materialName || !(material instanceof MeshStandardMaterial)) return material;
      const copy = material.clone();
      signals.push({ material: copy, color: copy.color.clone(), emissive: copy.emissive.clone() });
      return copy;
    };
    node.material = Array.isArray(node.material) ? node.material.map(cloneSignal) : cloneSignal(node.material);
  });

  // The tunnel has no signal ("gradient") material yet: inspection still runs, only the colour flash is skipped.
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
    halfWidth: SCAN_TUNNEL.halfBeltWidth,
    setSignal,
    dispose: () => signals.forEach(({ material }) => material.dispose()),
  };
}