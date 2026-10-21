import { MousePointer2, Ruler } from "lucide-react";
import { useSceneStore } from "@/stores/useSceneStore";
import { useFloorDrawingStore } from "@/stores/useFloorDrawingStore";
import { cn } from "@/lib/style";

export default function FloorDrawingGuide() {
  const pending = useSceneStore((state) => state.pending);
  const drawing = useFloorDrawingStore((state) => state.drawing);
  if (pending !== "floor") return null;
  const adjustingHeight = drawing?.phase === "height";

  return (
    <aside
      aria-label="바닥 및 벽 그리기 안내"
      className="pointer-events-none absolute bottom-4 left-16 right-4 rounded-xl border border-white/10 bg-bg-primary/95 p-4 text-text-primary shadow-xl backdrop-blur-md sm:right-auto sm:w-80"
    >
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
        <Ruler size={15} className="text-sky-400" />
        바닥 / 벽 만들기
      </div>
      <div role="status" className="space-y-1.5 text-xs leading-relaxed">
        <p className={cn(!adjustingHeight ? "text-sky-300" : "text-text-secondary")}>
          1. 드래그하여 바닥 생성
        </p>
        <p className={cn(adjustingHeight ? "text-sky-300" : "text-text-secondary")}>
          2. 드래그가 끝나면 마우스를 이동하여 벽 높이 조정
        </p>
      </div>
      <dl className="my-3 grid grid-cols-3 gap-2 border-y border-white/10 py-3">
        {([
          ["바닥 너비", drawing?.width],
          ["바닥 깊이", drawing?.depth],
          ["벽 높이", drawing?.wallHeight],
        ] as const).map(([label, value]) => (
          <div key={label}>
            <dt className="text-[10px] text-text-secondary">{label}</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">
              {value === undefined ? "—" : `${value.toFixed(1)} m`}
            </dd>
          </div>
        ))}
      </dl>
      <p className="flex items-center gap-1.5 text-[11px] text-text-secondary">
        <MousePointer2 size={12} />
        {adjustingHeight ? "클릭: 확정 · Esc: 바닥만 생성" : "마우스 왼쪽 버튼으로 드래그 · Esc: 취소"}
      </p>
      <p className="mt-1.5 text-[11px] text-text-secondary">휠: 줌 · 오른쪽 드래그: 팬</p>
    </aside>
  );
}
