import Panel from "@/features/Hud/_components/Panel";
import { Bot, Boxes, Truck, Package, MapPin, ScanLine } from "lucide-react";
import { useSceneStore, EQUIPMENT_NAMES } from "@/stores/useSceneStore";
import type { EquipmentKind } from "@/types/layout";
import { cn } from "@/lib/style";
import { useRef } from "react";
import Icon from "@/components/Icon";
import Button from "@/components/Button";
import { useHudStore } from "@/stores/useHudStore";

const ASSETS = [
  { kind: "robot", icon: Bot },
  { kind: "pallet", icon: Package },
  { kind: "conveyor", icon: Boxes },
  { kind: "amr", icon: Truck },
  { kind: "dock", icon: MapPin },
  { kind: "scanner", icon: ScanLine },
] as const;

export default function AssetPalettePanel() {
  const dragImage = useRef<HTMLCanvasElement>(null);
  const closePanel = useHudStore((s) => s.closeWorkspacePanel);
  const editing = useSceneStore((s) => s.editing);
  const pending = useSceneStore((s) => s.pending);
  const objects = useSceneStore((s) => s.objects);
  const setPending = useSceneStore((s) => s.setPending);
  const clear = useSceneStore((s) => s.clear);
  const errors = useSceneStore((s) => s.errors);
  if (!editing) return null;

  return (
    <Panel aria-label="에셋 라이브러리" className="h-full flex-1 flex flex-col">
      <canvas
        ref={dragImage}
        width={1}
        height={1}
        aria-hidden
        className="pointer-events-none fixed -left-4 -top-4"
      />
      <div className="mb-3 flex justify-between">
        <h2 className="text-sm font-semibold">에셋</h2>
        <Button
          aria-label="에셋 패널 닫기"
          className="size-6 px-0"
          onClick={closePanel}
        >
          <Icon icon="X" />
        </Button>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="mb-3 space-y-1 text-xs text-warning">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2">
        {ASSETS.map(({ kind, icon: Icon }) => (
          <button
            key={kind}
            draggable
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
    </Panel>
  );
}
