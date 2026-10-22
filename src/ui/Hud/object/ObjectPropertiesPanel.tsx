import ScannerSettings from "@/ui/Hud/equipment/scanner/ScannerSettings";
import { useShallow } from "zustand/react/shallow";
import {
  EQUIPMENT_NAMES,
  selectedIds,
  useSceneStore,
} from "@/stores/useSceneStore";
import { ApplyAllButton, BulkNumber } from "@/ui/Hud/object/BulkField";
import { applyToIds } from "@/stores/actions/applyEquipmentSettings";
import Select from "@/components/Select";
import { FLOOR_CONFIG } from "@/constants/simulatorLayout";
import {
  beltConnections,
  connectedBeltIds,
} from "@/domain/conveyor/conveyorLayout";
import Panel from "@/ui/Hud/_components/Panel";
import LinkSection from "@/ui/Hud/equipment/details/_components/LinkSection";
import DoorSettings from "@/ui/Hud/equipment/door/DoorSettings";
import {
  SPEED_LIMITS,
  amrSpeedOf,
  beltSpeedOf,
  fromBoxesPerHour,
  fromMetersPerMinute,
  spawnIntervalOf,
  speedPatch,
  toBoxesPerHour,
  toMetersPerMinute,
} from "@/domain/simulation/equipmentSpeeds";

export default function ObjectPropertiesPanel({
  embedded = false,
}: {
  embedded?: boolean;
}) {
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
      selection: state.selection,
    })),
  );

  const object = state.objects.find((o) => o.id === state.selected);

  if (!object) return null;

  const settings = state.settings[object.id];
  // Multi-select: same kind → every field edits all of them; mixed kinds → only the common "작동 활성화".
  const ids = selectedIds({
    objects: state.objects,
    selected: object.id,
    selection: state.selection,
  });
  const multi = ids.length > 1;
  const kinds = new Set(
    ids.map((id) => state.objects.find((o) => o.id === id)?.kind),
  );
  const mixedKinds = kinds.size > 1;
  const targets = mixedKinds ? [object.id] : ids;
  const incoming = beltConnections(state.objects).incoming;
  // Belt speed is shared along a connected line: multi-edit expands to every connected segment.
  const beltTargets =
    object.kind === "conveyor"
      ? [
          ...new Set(
            targets.flatMap((id) => [...connectedBeltIds(state.objects, id)]),
          ),
        ]
          .filter((id) => id !== object.id)
          .concat(object.id)
      : targets;
  const enabledValues = ids.map((id) => state.settings[id]?.enabled);
  const enabledMixed = enabledValues.some(
    (value) => value !== settings.enabled,
  );
  const connectedInput =
    object.kind === "conveyor" &&
    beltConnections(state.objects).incoming.has(object.id);
  // Same look as the shared Select trigger (flat compact field).
  const input =
    "h-6 w-full min-w-0 rounded-[3px] border border-[#2c2e33] bg-[#1b1c1f] px-2 text-xs tabular-nums text-text-primary outline-none hover:border-[#3a3d43] focus:border-brand-primary disabled:opacity-40 disabled:hover:border-[#2c2e33] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
  const row = "grid grid-cols-[56px_1fr] items-center gap-2";
  const rowLabel = "text-xs text-text-secondary";
  // Scene pose is planar (x, z, yaw); the other axes are shown fixed.
  // Thin axis colour bar inside the left edge of each transform input (X red, Y green, Z blue).
  const AXIS_BAR = { x: "bg-axis-x", y: "bg-axis-y", z: "bg-axis-z" } as const;
  const axisField = (
    axis: "x" | "y" | "z",
    key: string,
    field: React.ReactNode,
  ) => (
    <span key={key} className="relative block min-w-0">
      <span
        aria-hidden
        className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[3px] rounded-full ${AXIS_BAR[axis]}`}
      />
      {field}
    </span>
  );
  const fixed = (value: number, axis: "x" | "y" | "z", group: string) =>
    axisField(
      axis,
      axis,
      <input
        aria-label={`${group} ${axis}`}
        className={`${input} pl-3`}
        value={value}
        disabled
        readOnly
      />,
    );
  const pose = (axis: "x" | "z" | "yaw", label: string) =>
    axisField(
      axis === "yaw" ? "y" : axis,
      label,
      <input
        aria-label={label}
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
        className={`${input} pl-3`}
      />,
    );

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
            : "flex min-h-0 flex-auto flex-col overflow-y-auto -mr-4 pr-2.5 [scrollbar-gutter:stable] scrollbar-thin"
        }
      >
        <Select
          label="선택한 오브젝트"
          value={object.id}
          options={state.objects.map((o) => ({ value: o.id, label: o.name }))}
          onValueChange={state.select}
        />

        {multi && (
          <div className="mt-2 rounded-[3px] border border-[#2c2e33] bg-[#1b1c1f] px-2 py-1.5 text-[11px] text-text-secondary">
            <span className="text-text-primary">{ids.length}개 선택됨</span>
            {mixedKinds
              ? ` · ${[...kinds].map((kind) => (kind ? EQUIPMENT_NAMES[kind] : "")).join(", ")} 혼합: 공통 설정만 표시`
              : ` · ${EQUIPMENT_NAMES[object.kind]} 일괄 편집`}
            <span className="mt-0.5 block">
              위치·회전은 활성 오브젝트({object.name}) 기준
            </span>
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2">
          {(
            [
              [
                "position",
                [
                  pose("x", "position x"),
                  fixed(0, "y", "position"),
                  pose("z", "position z"),
                ],
              ],
              [
                "rotation",
                [
                  fixed(0, "x", "rotation"),
                  pose("yaw", "rotation y °"),
                  fixed(0, "z", "rotation"),
                ],
              ],
              [
                "scale",
                [
                  fixed(1, "x", "scale"),
                  fixed(1, "y", "scale"),
                  fixed(1, "z", "scale"),
                ],
              ],
            ] as const
          ).map(([label, fields]) => (
            <div key={label} className={row}>
              <span className={rowLabel}>{label}</span>
              <div className="grid grid-cols-3 gap-1">{fields}</div>
            </div>
          ))}
        </div>
        {!multi && object.kind === "floor" && object.floor && (
          <section className="mt-5 border-t border-white/10 pt-4">
            <h3 className="mb-3 text-xs text-text-primary">바닥 / 벽</h3>
            <div className="flex flex-col gap-2">
              {(
                [
                  ["width", "너비", 1],
                  ["depth", "깊이", 1],
                  ["wallHeight", "높이", FLOOR_CONFIG.wallStep],
                ] as const
              ).map(([key, label, step]) => (
                <label key={key} className={row}>
                  <span className={rowLabel}>{label}</span>
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
        {!mixedKinds && object.kind === "door" && (
          <section className="mt-5 border-t border-white/10 pt-4">
            <h3 className="mb-1 text-xs text-text-primary">문</h3>
            <DoorSettings id={object.id} ids={targets} inputClassName={input} />
          </section>
        )}
        {mixedKinds && (
          <section className="mt-5 border-t border-white/10 pt-4">
            <h3 className="mb-3 text-xs text-text-primary">공통 설정</h3>
            <label className="flex items-center gap-2 text-xs text-text-primary">
              <input
                type="checkbox"
                checked={settings.enabled}
                ref={(el) => {
                  if (el) el.indeterminate = enabledMixed;
                }}
                onChange={(e) =>
                  applyToIds(ids, () => ({ enabled: e.currentTarget.checked }))
                }
              />
              작동 활성화
              {enabledMixed && (
                <span className="text-text-secondary">(혼합)</span>
              )}
            </label>
          </section>
        )}
        {!mixedKinds &&
          object.kind !== "dock" &&
          object.kind !== "rack" &&
          object.kind !== "floor" &&
          object.kind !== "door" && (
            <section className="mt-5 border-t border-white/10 pt-4">
              <h3 className="mb-3 text-xs text-text-primary">
                시뮬레이션 설정
              </h3>
              {object.kind === "robot" && (
                <>
                  <BulkNumber
                    ids={targets}
                    kind="robot"
                    label="작동 속도"
                    unit="×"
                    min={0}
                    exclusiveMin
                    inputClassName={input}
                    read={(c) => c.speed}
                    write={(value) => ({ speed: value })}
                  />
                </>
              )}
              {object.kind === "amr" && (
                <BulkNumber
                  ids={targets}
                  kind="amr"
                  label="최대 주행 속도"
                  unit="m/s"
                  {...SPEED_LIMITS.amrSpeed}
                  inputClassName={input}
                  read={amrSpeedOf}
                  write={(value, c) => speedPatch("amrSpeed", value, c)}
                />
              )}
              {object.kind === "conveyor" && (
                <BulkNumber
                  ids={beltTargets}
                  kind="conveyor"
                  label="연결 컨베이어 속도"
                  unit="m/min"
                  decimals={2}
                  {...SPEED_LIMITS.beltSpeed}
                  inputClassName={input}
                  read={(c) => toMetersPerMinute(beltSpeedOf(c))}
                  write={(value, c) =>
                    speedPatch("beltSpeed", fromMetersPerMinute(value), c)
                  }
                />
              )}
              {object.kind === "scanner" && (
                <ScannerSettings
                  id={object.id}
                  ids={targets}
                  inputClassName={input}
                />
              )}

              {object.kind === "robot" && (
                <BulkNumber
                  className="mt-3"
                  ids={targets}
                  kind="robot"
                  label="집기 범위"
                  unit="m"
                  min={0}
                  exclusiveMin
                  inputClassName={input}
                  read={(c) => c.reach}
                  write={(value) => ({ reach: value })}
                />
              )}
              {object.kind === "pallet" && (
                <BulkNumber
                  ids={targets}
                  kind="pallet"
                  label="적재 개수"
                  unit="개"
                  integer
                  min={1}
                  inputClassName={input}
                  read={(c) => c.capacity}
                  write={(value) => ({ capacity: value })}
                />
              )}
              {object.kind === "conveyor" &&
                (connectedInput ? (
                  <p className="mt-3 text-xs text-text-secondary">
                    앞 구간에서 넘어오는 박스를 이송합니다.
                  </p>
                ) : (
                  <BulkNumber
                    className="mt-3"
                    ids={targets.filter((id) => !incoming.has(id))}
                    kind="conveyor"
                    applyFilter={(id) =>
                      !beltConnections(
                        useSceneStore.getState().objects,
                      ).incoming.has(id)
                    }
                    label="박스 투입량"
                    unit="개/h"
                    decimals={2}
                    {...SPEED_LIMITS.spawnInterval}
                    inputClassName={input}
                    read={(c) => toBoxesPerHour(spawnIntervalOf(c))}
                    write={(value, c) =>
                      speedPatch("spawnInterval", fromBoxesPerHour(value), c)
                    }
                  />
                ))}
              <div className="mt-4 flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-text-primary">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    ref={(el) => {
                      if (el) el.indeterminate = enabledMixed;
                    }}
                    onChange={(e) =>
                      applyToIds(targets, () => ({
                        enabled: e.currentTarget.checked,
                      }))
                    }
                  />
                  작동 활성화
                  {enabledMixed && (
                    <span className="text-text-secondary">(혼합)</span>
                  )}
                </label>
                <ApplyAllButton
                  kind={object.kind}
                  patch={() => ({ enabled: settings.enabled })}
                />
              </div>
            </section>
          )}
        {/* {state.editing && object.kind === "conveyor" && (
          <p className="mt-4 text-[11px] leading-relaxed text-sky-300/80">
            끝점의 +를 눌러 좌회전 · 직진 · 우회전 구간을 연결하세요. 끝점끼리
            가까이 놓으면 자동으로 붙습니다.
          </p>
        )} */}
        <div className="mt-3">
          <LinkSection object={object} />
        </div>
        {/* {state.editing && (
          <Button
            type="button"
            onClick={() => useSceneStore.getState().removeMany(ids)}
            className="mt-auto self-end w-full border-fault text-fault"
          >
            {multi ? `Delete (${ids.length})` : "Delete"}
          </Button>
        )} */}
      </div>
    </Panel>
  );
}
