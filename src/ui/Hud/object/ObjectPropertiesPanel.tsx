import ScannerSettings from "@/ui/Hud/equipment/scanner/ScannerSettings";
import { useShallow } from "zustand/react/shallow";
import { useSceneStore } from "@/stores/useSceneStore";
import Select from "@/components/Select";
import Button from "@/components/Button";
import { SIMULATOR_CONFIG, FLOOR_CONFIG } from "@/constants/simulatorLayout";
import { beltConnections } from "@/domain/conveyor/conveyorLayout";
import { useSimulationStore } from "@/stores/useSimulationStore";
import Panel from "@/ui/Hud/_components/Panel";

export default function ObjectPropertiesPanel({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const playbackSpeed = useSimulationStore((state) => state.speed);
  const state = useSceneStore(
    useShallow((state) => ({
      objects: state.objects,
      selected: state.selected,
      settings: state.settings,
      editing: state.editing,
      tool: state.tool,
      select: state.select,
      setTool: state.setTool,
      updatePose: state.updatePose,
      updateSettings: state.updateSettings,
      updateFloor: state.updateFloor,
      remove: state.remove,
    })),
  );

  const object = state.objects.find((o) => o.id === state.selected);

  if (!object) return null;

  const settings = state.settings[object.id];
  const connectedInput =
    object.kind === "conveyor" &&
    beltConnections(state.objects).incoming.has(object.id);
  const input =
    "mt-1 h-9 w-full rounded-md border border-white/10 bg-white/5 px-2 text-xs text-white outline-none focus:border-sky-400 disabled:opacity-40";

  return (
    <Panel
      aria-label="오브젝트 속성"
      embedded={embedded}
      className={embedded ? undefined : "h-full min-h-0 flex-1 overflow-hidden"}
    >
      {!embedded && (
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="text-sm font-semibold">오브젝트 속성</h2>
          <button
            aria-label="속성 패널 닫기"
            onClick={() => state.select(null)}
            className="text-text-secondary"
          >
            ×
          </button>
        </div>
      )}
      {/* Header stays fixed; only the property body scrolls. */}
      <div
        className={
          embedded
            ? undefined
            : "-mr-2 flex min-h-0 flex-auto flex-col overflow-y-auto pr-2 [scrollbar-color:#334155_transparent] [scrollbar-width:thin]"
        }
      >
        <Select
          label="선택한 오브젝트"
          value={object.id}
          options={state.objects.map((o) => ({ value: o.id, label: o.name }))}
          onValueChange={state.select}
        />
        <p className="mt-4 text-xs text-text-secondary">위치와 회전</p>
        {state.editing && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["translate", "rotate"] as const).map((tool) => (
              <Button
                key={tool}
                fill={state.tool === tool}
                onClick={() => state.setTool(tool)}
              >
                {tool === "translate" ? "이동" : "회전"}
              </Button>
            ))}
          </div>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["x", "z", "yaw"] as const).map((axis) => (
            <label key={axis} className="text-xs text-text-secondary">
              {axis === "yaw" ? "회전 °" : `${axis.toUpperCase()} m`}
              <input
                aria-label={`오브젝트 ${axis}`}
                type="number"
                disabled={!state.editing}
                step={axis === "yaw" ? 15 : 0.1}
                value={Number(
                  (axis === "yaw"
                    ? (object.yaw * 180) / Math.PI
                    : object[axis]
                  ).toFixed(2),
                )}
                onChange={(e) => {
                  const value = e.currentTarget.valueAsNumber;
                  if (Number.isFinite(value))
                    state.updatePose(object.id, {
                      [axis]: axis === "yaw" ? (value * Math.PI) / 180 : value,
                    });
                }}
                className={input}
              />
            </label>
          ))}
        </div>
        {object.kind === "floor" && object.floor && (
          <section className="mt-5 border-t border-white/10 pt-4">
            <h3 className="mb-3 text-xs text-text-primary">바닥 / 벽</h3>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["width", "너비 m", 1],
                  ["depth", "깊이 m", 1],
                  ["wallHeight", "벽 높이 m", FLOOR_CONFIG.wallStep],
                ] as const
              ).map(([key, label, step]) => (
                <label key={key} className="text-xs text-text-secondary">
                  {label}
                  <input
                    aria-label={`바닥 ${label}`}
                    className={input}
                    type="number"
                    disabled={!state.editing}
                    min={key === "wallHeight" ? 0 : 1}
                    max={
                      key === "wallHeight"
                        ? FLOOR_CONFIG.maxWallHeight
                        : FLOOR_CONFIG.maxSize
                    }
                    step={step}
                    value={object.floor![key]}
                    onChange={(e) => {
                      const value = e.currentTarget.valueAsNumber;
                      if (Number.isFinite(value))
                        state.updateFloor(object.id, { [key]: value });
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-text-secondary">
              벽 높이 0 = 바닥만. 벽을 올리면 기둥과 천장 트러스가 함께
              생성됩니다. 위에서 보면 천장이 숨겨지고, 내부 시점에서는
              표시됩니다.
            </p>
          </section>
        )}
        {object.kind !== "dock" && object.kind !== "rack" && object.kind !== "floor" && (
          <section className="mt-5 border-t border-white/10 pt-4">
            <h3 className="mb-3 text-xs text-text-primary">시뮬레이션 설정</h3>
            {object.kind !== "pallet" && object.kind !== "scanner" && (
              <label className="block text-xs text-text-secondary">
                {object.kind === "conveyor"
                  ? "연결 컨베이어 속도 ×"
                  : "작동 속도 ×"}
                <input
                  aria-label="작동 속도"
                  className={input}
                  type="number"
                  min={0.25}
                  max={3}
                  step={0.25}
                  value={settings.speed}
                  onChange={(e) => {
                    const value = e.currentTarget.valueAsNumber;
                    if (value >= 0.25 && value <= 3)
                      state.updateSettings(object.id, { speed: value });
                  }}
                />
              </label>
            )}
            {object.kind !== "pallet" && object.kind !== "scanner" && (
              <p className="mt-1 text-xs text-text-secondary">
                {object.kind === "conveyor" ? "연결 구간" : "개별"}{" "}
                {settings.speed}× · 전체 {playbackSpeed}× → 실제{" "}
                {Number((settings.speed * playbackSpeed).toFixed(2))}×
              </p>
            )}
            {object.kind === "scanner" && (
              <ScannerSettings id={object.id} inputClassName={input} />
            )}

            {object.kind === "robot" && (
              <label className="mt-3 block text-xs text-text-secondary">
                집기 범위 m
                <input
                  aria-label="집기 범위"
                  className={input}
                  type="number"
                  min={0.5}
                  max={SIMULATOR_CONFIG.reach}
                  step={0.1}
                  value={settings.reach}
                  onChange={(e) => {
                    const value = e.currentTarget.valueAsNumber;
                    if (value >= 0.5 && value <= SIMULATOR_CONFIG.reach)
                      state.updateSettings(object.id, { reach: value });
                  }}
                />
              </label>
            )}
            {object.kind === "pallet" && (
              <label className="block text-xs text-text-secondary">
                적재 개수
                <input
                  aria-label="적재 개수"
                  className={input}
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={settings.capacity}
                  onChange={(e) => {
                    const value = e.currentTarget.valueAsNumber;
                    if (Number.isInteger(value) && value >= 1 && value <= 100)
                      state.updateSettings(object.id, { capacity: value });
                  }}
                />
              </label>
            )}
            {object.kind === "conveyor" &&
              (connectedInput ? (
                <p className="mt-3 text-xs text-text-secondary">
                  앞 구간에서 넘어오는 박스를 이송합니다.
                </p>
              ) : (
                <label className="mt-3 block text-xs text-text-secondary">
                  박스 생성 간격 s
                  <input
                    aria-label="박스 생성 간격"
                    className={input}
                    type="number"
                    min={2}
                    max={30}
                    step={1}
                    value={settings.spawnInterval}
                    onChange={(e) => {
                      const value = e.currentTarget.valueAsNumber;
                      if (value >= 2 && value <= 30)
                        state.updateSettings(object.id, {
                          spawnInterval: value,
                        });
                    }}
                  />
                </label>
              ))}
            <label className="mt-4 flex items-center gap-2 text-xs text-text-primary">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) =>
                  state.updateSettings(object.id, {
                    enabled: e.currentTarget.checked,
                  })
                }
              />
              작동 활성화
            </label>
          </section>
        )}
        {state.editing && object.kind === "conveyor" && (
          <p className="mt-4 text-[11px] leading-relaxed text-sky-300/80">
            끝점의 +를 눌러 좌회전 · 직진 · 우회전 구간을 연결하세요. 끝점끼리
            가까이 놓으면 자동으로 붙습니다.
          </p>
        )}
        {state.editing && (
          <Button
            type="button"
            onClick={() => state.remove(object.id)}
            className="mt-auto self-end w-full border-fault text-fault"
          >
            Delete
          </Button>
        )}
      </div>
    </Panel>
  );
}
