import type { SceneTemplate } from "@/types/sceneTemplate";
import { CONVEYOR_LAYOUT } from "@/constants/conveyorLayoutConfig";

export default function TemplatePreview({ template }: { template: SceneTemplate }) {
  const xs = template.equipment.map((object) => object.x);
  const zs = template.equipment.map((object) => object.z);
  const minX = Math.min(...xs) - 1;
  const minZ = Math.min(...zs) - 1.5;
  const width = Math.max(...xs) - minX + 1;
  const height = Math.max(...zs) - minZ + 1.5;

  return (
    <svg role="img" aria-label={`${template.name} 배치 미리보기`} viewBox={`${minX} ${minZ} ${width} ${height}`} className="h-28 w-full rounded-lg bg-bg-primary/60 text-brand-primary">
      {template.equipment.map((object, index) => (
        <g key={index} transform={`translate(${object.x} ${object.z}) rotate(${-object.yaw * 180 / Math.PI})`}>
          {object.kind === "robot" ? (
            <><circle r={0.65} fill="none" stroke="currentColor" strokeWidth={0.025} opacity={0.4} /><circle r={0.16} fill="currentColor" /></>
          ) : object.kind === "conveyor" ? (
            <rect x={-CONVEYOR_LAYOUT.width / 2} y={-CONVEYOR_LAYOUT.length / 2} width={CONVEYOR_LAYOUT.width} height={CONVEYOR_LAYOUT.length} fill="currentColor" opacity={0.35} />
          ) : (
            <rect x={-0.24} y={-0.24} width={0.48} height={0.48} rx={0.06} fill={object.kind === "scanner" ? "#f9c335" : object.kind === "pallet" ? "#c8a879" : "#19de86"} />
          )}
        </g>
      ))}
    </svg>
  );
}
