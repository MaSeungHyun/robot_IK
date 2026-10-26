import { Fragment, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import Button from "@/components/Button";
import Icon from "@/components/Icon";
import SideTooltip from "@/components/SideTooltip";
import { ASSET_PRESETS, thumbnailKey } from "@/constants/assetPresets";
import type { AssetPreset } from "@/constants/assetPresets";
import { SCENE_TEMPLATES } from "@/constants/sceneTemplates";
import { applySceneTemplate } from "@/stores/actions/applySceneTemplate";
import { useSceneStore, EQUIPMENT_NAMES } from "@/stores/useSceneStore";
import { useThumbnailStore } from "@/stores/useThumbnailStore";
import { useLogStore } from "@/stores/useLogStore";
import type { EquipmentKind } from "@/types/layout";
import TemplatePreview from "@/ui/Hud/template/TemplatePreview";
import LogPanel from "@/ui/Hud/log/LogPanel";
import { cn } from "@/lib/style";
import { useHudStore } from "@/stores/useHudStore";

type IconName = ComponentProps<typeof Icon>["icon"];
type Item = "templates" | "log" | EquipmentKind;
const railButton =
  "flex size-10 shrink-0 items-center justify-center rounded-md text-text-secondary outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-primary";
const flyout =
  "absolute top-2 left-full ml-2 max-h-[calc(100%-1rem)] overflow-y-auto scrollbar-thin rounded-md border border-brand-primary/20 bg-bg-primary/95 p-3 shadow-2xl backdrop-blur-md";

/**
 * Editor-only icon rail: Templates first, then asset categories. Each opens a flyout grid;
 * an asset card starts placement with its preset, a template card loads the layout.
 */
export default function AssetRail() {
  const open = useHudStore((s) => s.assetFlyout) as Item | null;
  const setOpen = useHudStore((s) => s.setAssetFlyout);
  // The log panel is independent of the flyouts: only its own button/close button closes it.
  const [logOpen, setLogOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pending = useSceneStore((s) => s.pending);
  const errors = useLogStore(
    (s) => s.entries.filter((entry) => entry.level === "error").length,
  );
  const warnings = useLogStore(
    (s) => s.entries.filter((entry) => entry.level === "warning").length,
  );

  // Esc closes the flyout. A click outside closes only the template flyout: an asset category stays open while
  // placing (clicks/drops in the viewport), so several items can be placed in a row.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (open === "templates" && !root.current?.contains(event.target as Node)) setOpen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape);
    };
  }, [open, setOpen]);

  const toggle = (item: Item) => {
    if (item === "log") setLogOpen((value) => !value);
    else setOpen(open === item ? null : item);
  };
  const items: { id: Item; label: string; icon: string }[] = [
    { id: "templates", label: "템플릿", icon: "LayoutTemplate" },
    ...ASSET_PRESETS.map(({ kind, icon }) => ({
      id: kind,
      label: EQUIPMENT_NAMES[kind],
      icon,
    })),
  ];
  const category = ASSET_PRESETS.find((item) => item.kind === open);

  return (
    <div
      ref={root}
      className="pointer-events-auto relative z-300 flex h-full shrink-0"
    >
      <nav
        aria-label="에셋"
        className="flex h-full w-12 flex-col items-center gap-1.5 border-r border-brand-primary/20 bg-bg-primary/85 py-2 backdrop-blur-md"
      >
        {items.map(({ id, label, icon }, index) => (
          <Fragment key={id}>
            {/* Divider is its own element so it doesn't eat into the fixed-size button and push the icon down. */}
            {index === 1 && (
              <span aria-hidden className="h-px w-7 shrink-0 bg-white/10" />
            )}
            <button
              type="button"
              aria-label={label}
              aria-expanded={open === id}
              onClick={() => toggle(id)}
              className={cn(
                railButton,
                "group/tip relative",
                (open === id || pending === id) &&
                  "bg-brand-primary/10 text-brand-primary",
              )}
            >
              <Icon
                icon={icon as IconName}
                aria-hidden="true"
                className="size-5"
              />
              <SideTooltip label={label} />
            </button>
          </Fragment>
        ))}
        <button
          type="button"
          aria-label="로그"
          aria-expanded={logOpen}
          onClick={() => toggle("log")}
          className={cn(
            railButton,
            "group/tip relative mt-auto",
            logOpen && "bg-brand-primary/10 text-brand-primary",
          )}
        >
          <Icon icon="Terminal" aria-hidden="true" className="size-5" />
          <SideTooltip label="로그" />
          {/* Red (errors) takes precedence over yellow (warnings). */}
          {errors > 0 ? (
            <span
              className="absolute top-1 right-1 size-2 rounded-full bg-fault"
              aria-label={`오류 ${errors}건`}
            />
          ) : warnings > 0 ? (
            <span
              className="absolute top-1 right-1 size-2 rounded-full bg-warning"
              aria-label={`경고 ${warnings}건`}
            />
          ) : null}
        </button>
      </nav>
      {open === "templates" && <TemplateFlyout onDone={() => setOpen(null)} />}
      {logOpen && (
        <div
          role="region"
          aria-label="로그"
          className={cn(flyout, "top-auto bottom-2 w-96")}
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">로그</h2>
            <button
              type="button"
              aria-label="로그 닫기"
              title="닫기"
              onClick={() => setLogOpen(false)}
              className="flex size-6 items-center justify-center rounded-md text-text-secondary outline-none transition hover:bg-white/10 hover:text-text-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
            >
              <Icon icon="X" aria-hidden="true" className="size-3.5" />
            </button>
          </div>
          <LogPanel />
        </div>
      )}
      {category && (
        <AssetFlyout kind={category.kind} presets={category.presets} />
      )}
    </div>
  );
}

function TemplateFlyout({ onDone }: { onDone: () => void }) {
  const clear = useSceneStore((s) => s.clear);
  return (
    <div role="dialog" aria-label="템플릿" data-keeps-shortcuts="" className={cn(flyout, "w-96")}>
      <h2 className="mb-2 text-sm font-semibold text-text-primary">템플릿</h2>
      <div className="grid grid-cols-2 gap-2">
        {SCENE_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            aria-label={`${template.name} 불러오기`}
            title={template.description}
            onClick={() => {
              applySceneTemplate(template);
              onDone();
            }}
            className="flex flex-col gap-1.5 rounded-md border border-white/10 bg-white/5 p-1.5 text-left transition hover:border-sky-400/60 hover:bg-sky-400/10"
          >
            <TemplatePreview template={template} />
            <span className="truncate text-xs font-medium text-text-primary">
              {template.name}
            </span>
            <span className="text-[10px] text-text-secondary">
              {template.equipment.length}개 설비
            </span>
          </button>
        ))}
      </div>
      <Button className="mt-3 w-full" onClick={clear}>
        Clear (전체 배치 지우기)
      </Button>
    </div>
  );
}

function AssetFlyout({
  kind,
  presets,
}: {
  kind: EquipmentKind;
  presets: AssetPreset[];
}) {
  const dragImage = useRef<HTMLCanvasElement>(null);
  const objects = useSceneStore((s) => s.objects);
  const setPending = useSceneStore((s) => s.setPending);
  const thumbnails = useThumbnailStore((s) => s.thumbnails);
  const icon = ASSET_PRESETS.find((item) => item.kind === kind)?.icon ?? "Box";

  return (
    <div
      role="dialog"
      aria-label={`${EQUIPMENT_NAMES[kind]} 프리셋`}
      data-keeps-shortcuts=""
      className={cn(flyout, "w-72")}
    >
      <canvas
        ref={dragImage}
        width={1}
        height={1}
        aria-hidden
        className="pointer-events-none fixed -left-4 -top-4"
      />
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-text-primary">
          {EQUIPMENT_NAMES[kind]}
        </h2>
        <span className="text-[10px] text-text-secondary">
          {objects.filter((o) => o.kind === kind).length}개 배치됨
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((preset) => {
          const key = thumbnailKey(kind, preset),
            image = key ? thumbnails[key] : undefined;
          return (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              // Floor/wall is drawn by dragging on the ground after picking it, not dropped.
              draggable={kind !== "floor"}
              onDragStart={(event) => {
                setPending(kind, preset.settings ?? null);
                if (dragImage.current)
                  event.dataTransfer.setDragImage(dragImage.current, 0, 0);
                event.dataTransfer.setData(
                  "application/x-factory-equipment",
                  kind,
                );
                event.dataTransfer.effectAllowed = "copy";
              }}
              onDragEnd={() => setPending(null)}
              // The category stays open after placing (only the rail button or Esc closes it).
              onClick={() => setPending(kind, preset.settings ?? null)}
              className={cn(
                "flex cursor-grab flex-col gap-1.5 overflow-hidden rounded-md border border-white/10 bg-white/5 p-1.5 text-left transition hover:border-sky-400/60 hover:bg-sky-400/10 active:cursor-grabbing",
                preset.tone === "defect" && "border-l-2 border-l-fault",
                preset.tone === "normal" && "border-l-2 border-l-safe",
              )}
            >
              <span className="flex aspect-4/3 w-full items-center justify-center rounded-sm bg-[radial-gradient(ellipse_at_50%_80%,rgba(0,120,200,0.3),transparent_75%)]">
                {image ? (
                  <img
                    src={image}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <Icon
                    icon={icon as IconName}
                    aria-hidden="true"
                    className="size-8 text-text-secondary"
                  />
                )}
              </span>
              <span className="text-xs font-medium text-text-primary">
                {preset.label}
              </span>
              <span className="line-clamp-2 text-[10px] leading-4 text-text-secondary">
                {preset.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
