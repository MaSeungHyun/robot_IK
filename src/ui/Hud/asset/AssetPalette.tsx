import { Bot, Boxes, Truck, Package, MapPin, ScanLine, BrickWall } from "lucide-react";
import { useSceneStore, EQUIPMENT_NAMES } from "@/stores/useSceneStore";
import type { EquipmentKind } from "@/types/layout";
import { cn } from "@/lib/style";
import { useRef } from "react";
import Button from "@/components/Button";

const ASSETS = [
  { kind: "robot", icon: Bot },
  { kind: "pallet", icon: Package },
  { kind: "conveyor", icon: Boxes },
  { kind: "amr", icon: Truck },
  { kind: "dock", icon: MapPin },
  { kind: "scanner", icon: ScanLine },
  { kind: "floor", icon: BrickWall },
] as const;

export default function AssetPalette() {
  const dragImage = useRef<HTMLCanvasElement>(null);
  const editing = useSceneStore((s) => s.editing);
  const pending = useSceneStore((s) => s.pending);
  const objects = useSceneStore((s) => s.objects);
  const setPending = useSceneStore((s) => s.setPending);
  const clear = useSceneStore((s) => s.clear);
  if (!editing) return null;

  return (
    <div aria-label="에셋 목록" className="flex flex-1 flex-col gap-4">
      <canvas
        ref={dragImage}
        width={1}
        height={1}
        aria-hidden
        className="pointer-events-none fixed -left-4 -top-4"
      />

      <div className="grid grid-cols-2 gap-2">
        {ASSETS.map(({ kind, icon: Icon }) => (
          <button
            key={kind}
            // Floor/wall is drawn by dragging on the ground after picking it, not dropped.
            draggable={kind !== "floor"}
            title={kind === "floor" ? "선택 후 바닥을 드래그해 영역 지정 → 마우스로 벽 높이 → 클릭 확정 (Esc: 벽 없이 확정 · 휠: 줌 · 오른쪽 드래그: 팬)" : undefined}
            aria-label={`${EQUIPMENT_NAMES[kind]} 에셋 추가`}
            onDragEnd={() => setPending(null)}
            onDragStart={(e) => {
              setPending(kind);
              if (dragImage.current)
                e.dataTransfer.setDragImage(dragImage.current, 0, 0);
              e.dataTransfer.setData("application/x-factory-equipment", kind);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => setPending(kind as EquipmentKind)}
            className={cn(
              "flex cursor-grab items-center gap-2 rounded-xl border p-3 text-left text-xs active:cursor-grabbing",
              pending === kind
                ? "border-sky-400 bg-sky-400/10 text-sky-200"
                : "border-white/10 bg-white/5 text-text-primary",
            )}
          >
            <Icon size={17} />
            <span>
              {EQUIPMENT_NAMES[kind]}
              <span className="mt-1 block text-[9px] text-text-secondary">
                {objects.filter((o) => o.kind === kind).length}개 배치됨
              </span>
            </span>
          </button>
        ))}
      </div>
      <Button className="mt-auto self-end w-full" onClick={clear}>
        Clear
      </Button>
    </div>
  );
}
