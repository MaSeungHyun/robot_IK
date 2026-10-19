import Panel from "@/features/Hud/_components/Panel";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useEffect, useRef } from "react";
import { PACKING, STREAM_CONFIG, BOX_SIZES } from "@/constants/simulation";

export default function PackingPanel() {
  const snapshot = useSimulationStore((state) => state.diagnostics);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useSimulationStore((state) => state.layer);
  const setLayer = useSimulationStore((state) => state.setLayer);
  const cell = useSimulationStore((state) => state.cell);
  const setCell = useSimulationStore((state) => state.setCell);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.setTransform(2, 0, 0, 2, 0, 0);
    context.clearRect(0, 0, 320, 320);
    const columns =
        snapshot?.columns ??
        Math.round(STREAM_CONFIG.palletWidth / PACKING.cell),
      rows =
        snapshot?.rows ?? Math.round(STREAM_CONFIG.palletWidth / PACKING.cell);
    const side = 264,
      start = 28,
      w = side / columns,
      h = side / rows;
    const level = layer === "top" ? null : Number(layer);
    context.save();
    context.translate(320, 0);
    context.rotate(Math.PI / 2);
    const drawText = (text: string, x: number, y: number) => {
      context.save();
      context.translate(x, y);
      context.rotate(-Math.PI / 2);
      context.fillText(text, 0, 0);
      context.restore();
    };
    context.font = "11px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (let z = 0; z < rows; z++)
      for (let x = 0; x < columns; x++) {
        const height = snapshot?.heights[z * columns + x] ?? 0,
          filled =
            level === null ? height > 0 : height > level + PACKING.epsilon;
        context.fillStyle = filled
          ? `rgba(59,130,246,${0.3 + Math.min(height, 5) * 0.12})`
          : "#172033";
        context.fillRect(start + x * w, start + z * h, w, h);
        context.strokeStyle = "#475569";
        context.lineWidth = 0.6;
        context.strokeRect(start + x * w, start + z * h, w, h);
        context.fillStyle = filled ? "#e2e8f0" : "#64748b";
        if (w >= 26)
          drawText(
            height ? `${Number(height.toFixed(3))}m` : "·",
            start + (x + 0.5) * w,
            start + (z + 0.5) * h,
          );
      }
    for (const candidate of snapshot?.candidates ?? []) {
      if (
        candidate.state !== "rejected" ||
        candidate.bottom !== (snapshot?.selected?.bottom ?? 0)
      )
        continue;
      context.fillStyle = "rgba(239,68,68,0.12)";
      context.fillRect(
        start + candidate.x * w,
        start + candidate.z * h,
        (candidate.width / (snapshot?.cell ?? 1)) * w,
        (candidate.depth / (snapshot?.cell ?? 1)) * h,
      );
    }
    for (const box of snapshot?.boxes ?? []) {
      if (
        level !== null &&
        (level < box.bottom - PACKING.epsilon ||
          level >= box.bottom + box.height - PACKING.epsilon)
      )
        continue;
      if (
        level === null &&
        snapshot &&
        !snapshot.heights.some((height, i) => {
          const x = i % columns,
            z = Math.floor(i / columns);
          return (
            x >= box.x &&
            x < box.x + box.width / snapshot.cell &&
            z >= box.z &&
            z < box.z + box.depth / snapshot.cell &&
            Math.abs(height - box.bottom - box.height) < PACKING.epsilon
          );
        })
      )
        continue;
      context.strokeStyle = "#cbd5e1";
      context.lineWidth = 1.4;
      context.strokeRect(
        start + box.x * w + 1,
        start + box.z * h + 1,
        (box.width / (snapshot?.cell ?? 1)) * w - 2,
        (box.depth / (snapshot?.cell ?? 1)) * h - 2,
      );
      if (w < 26) {
        context.fillStyle = "#e2e8f0";
        drawText(
          `${Number((box.bottom + box.height).toFixed(3))}m`,
          start + (box.x + box.width / (snapshot?.cell ?? 1) / 2) * w,
          start + (box.z + box.depth / (snapshot?.cell ?? 1) / 2) * h,
        );
      }
    }
    const anchorRanks = new Map<string, number>();
    for (const candidate of snapshot?.candidates ?? []) {
      if (candidate.bottom !== (snapshot?.selected?.bottom ?? 0)) continue;
      const key = `${candidate.x}:${candidate.z}`;
      anchorRanks.set(
        key,
        Math.min(anchorRanks.get(key) ?? Infinity, candidate.rank),
      );
    }
    context.font = "8px sans-serif";
    context.fillStyle = "#cbd5e1";
    context.textAlign = "left";
    if (w >= 26)
      for (const [key, rank] of anchorRanks) {
        const [x, z] = key.split(":").map(Number);
        drawText(`#${rank}`, start + x * w + 3, start + z * h + 6);
      }
    context.font = "11px sans-serif";
    context.textAlign = "center";
    const selected = snapshot?.selected;
    if (selected) {
      context.strokeStyle =
        selected.state === "rejected"
          ? "#ef4444"
          : selected.state === "placed"
            ? "#22c55e"
            : "#fbbf24";
      context.lineWidth = 3;
      context.setLineDash(selected.state === "searching" ? [5, 3] : []);
      context.strokeRect(
        start + selected.x * w + 2,
        start + selected.z * h + 2,
        (selected.width / (snapshot?.cell ?? 1)) * w - 4,
        (selected.depth / (snapshot?.cell ?? 1)) * h - 4,
      );
      context.setLineDash([]);
    }
    context.restore();
    context.fillStyle = "#94a3b8";
    for (let x = 0; x < columns; x++)
      context.fillText(String(x + 1), 14, start + (x + 0.5) * w);
    for (let z = 0; z < rows; z++)
      context.fillText(String(rows - z), 320 - start - (z + 0.5) * h, 14);
    context.textAlign = "left";
    context.fillText("위: 먼 쪽 −X", start, 307);
    context.textAlign = "right";
    context.fillText("아래: +X 로봇 쪽", start + side, 307);
  }, [snapshot, layer]);
  const displayCell = (x: number, z: number, depthCells = 1) =>
    `${(snapshot?.rows ?? Math.round(STREAM_CONFIG.palletWidth / PACKING.cell)) - z - depthCells + 1}, ${x + 1}`;
  const progress = snapshot?.candidateCount
    ? Math.round((snapshot.inspected / snapshot.candidateCount) * 100)
    : 0;
  const rejected = (snapshot?.candidates ?? [])
    .filter((c) => c.state === "rejected")
    .slice(0, 6);
  return (
    <Panel className="rounded-xl border-slate-700 bg-slate-950/95 text-slate-100">
      <div className="text-base font-semibold">
        층별 고정 순서 ·{" "}
        {snapshot?.columns ??
          Math.round(STREAM_CONFIG.palletWidth / PACKING.cell)}
        ×
        {snapshot?.rows ?? Math.round(STREAM_CONFIG.palletWidth / PACKING.cell)}{" "}
        격자
      </div>
      <div className="mt-1 text-xs text-slate-400">
        좌상단 (1,1) · 한 칸 {(snapshot?.cell ?? PACKING.cell) * 1000}mm ·
        위에서 본 팔레트 · 팔레트 {snapshot?.palletNumber ?? 1}번
      </div>
      <div className="mt-3 flex flex-wrap gap-1 text-xs">
        {[
          ["top", "높이 지도"],
          ...Array.from(
            {
              length: Math.max(
                1,
                Math.ceil(
                  Math.max(0, ...(snapshot?.heights ?? [])) / BOX_SIZES[0].y -
                    1e-7,
                ),
              ),
            },
            (_, i) => {
              const h = Number((i * BOX_SIZES[0].y).toFixed(3));
              return [String(h), `${h}m`];
            },
          ),
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setLayer(value)}
            className={`rounded px-2 py-1 ${layer === value ? "bg-blue-600" : "bg-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <canvas
        ref={canvas}
        width={640}
        height={640}
        className="mt-2 w-full cursor-crosshair"
        aria-label="격자별 적재 높이와 현재 배치 후보"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect(),
            x = ((event.clientX - rect.left) * 320) / rect.width,
            z = ((event.clientY - rect.top) * 320) / rect.height;
          const cx = Math.floor(
              ((z - 28) / 264) *
                (snapshot?.columns ??
                  Math.round(STREAM_CONFIG.palletWidth / PACKING.cell)),
            ),
            cz = Math.floor(
              ((320 - x - 28) / 264) *
                (snapshot?.rows ??
                  Math.round(STREAM_CONFIG.palletWidth / PACKING.cell)),
            );
          if (
            cx >= 0 &&
            cz >= 0 &&
            cx <
              (snapshot?.columns ??
                Math.round(STREAM_CONFIG.palletWidth / PACKING.cell)) &&
            cz <
              (snapshot?.rows ??
                Math.round(STREAM_CONFIG.palletWidth / PACKING.cell))
          )
            setCell({ x: cx, z: cz });
        }}
      />
      <div className="text-xs text-slate-300">
        파랑: 적재 · 노랑: 선택/검사 · 빨강: 제외 · 초록: 완료
      </div>
      <div className="mt-1 text-xs text-slate-400">
        #숫자: 적재 순번 · 먼 곳부터 한 층씩
      </div>
      {cell && (
        <div className="mt-2 text-xs">
          칸 ({displayCell(cell.x, cell.z)}) 높이:{" "}
          {snapshot?.heights[cell.z * snapshot.columns + cell.x] ?? 0}m
        </div>
      )}
      <div className="mt-3 space-y-2 text-xs">
        {[
          ["전체 용량 충진율", (snapshot?.capacityFill ?? 0) * 100],
          ["바닥 채움", (snapshot?.floorFill ?? 0) * 100],
          [
            snapshot?.sequence ? "현재 층 적재율" : "후보 검사 완료율",
            snapshot?.sequence
              ? (snapshot.sequence.placedInLayer / snapshot.sequence.perLayer) *
                100
              : progress,
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="flex justify-between">
              <span>{label}</span>
              <span>{Number(value).toFixed(1)}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-800">
              <div
                className="h-full bg-blue-500"
                style={{ width: `${Math.min(100, Number(value))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-slate-400">
        {snapshot?.sequence
          ? `${snapshot.sequence.layer}층 ${snapshot.sequence.placedInLayer}/${snapshot.sequence.perLayer}개 완료 · 다음 #${snapshot.sequence.nextOrder} · 경로 실패 시 순서 유지`
          : `${snapshot?.inspected ?? 0}/${snapshot?.candidateCount ?? 0}개 위치 검사 · 최적해 확률이 아닙니다.`}
      </div>
      <div className="mt-3 border-t border-slate-700 pt-3 text-sm font-medium">
        {snapshot?.exchanging
          ? "팔레트 교체 중"
          : (snapshot?.phase ?? "시작 대기")}
      </div>
      <div className="mt-1 text-xs text-slate-300">
        {snapshot?.reason ?? "시작하면 후보 검사 과정이 표시됩니다."}
      </div>
      {snapshot?.selected && (
        <div className="mt-2 text-xs">
          다음 적재 #{snapshot.selected.rank} · 칸 (
          {displayCell(
            snapshot.selected.x,
            snapshot.selected.z,
            snapshot.selected.depth / snapshot.cell,
          )}
          ) · 바닥 {snapshot.selected.bottom}m · 회전{" "}
          {Math.round((snapshot.selected.yaw * 180) / Math.PI)}°
        </div>
      )}
      {rejected.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-slate-700 pt-3 text-xs">
          <div className="font-medium">현재 위치의 경로 실패 이유</div>
          {rejected.map((candidate) => (
            <div
              key={`${candidate.x}:${candidate.z}:${candidate.bottom}:${candidate.yaw}`}
              className="text-slate-300"
            >
              #{candidate.rank} (
              {displayCell(
                candidate.x,
                candidate.z,
                candidate.depth / (snapshot?.cell ?? 1),
              )}
              ) {candidate.bottom}m · {candidate.reason}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
