import { bookmarkScope, loadBookmarks } from "@/viewport/camera/cameraBookmarks";
import { loadView } from "@/viewport/camera/cameraPersist";
import { settingsFor, useSceneStore } from "@/stores/useSceneStore";
import { templateErrors } from "@/domain/layout/templateValidation";
import type { SceneTemplate, TemplateEquipment } from "@/types/sceneTemplate";
import type { TemplateLink } from "@/types/links";

const round = (v: number) => v; // lossless (yaw = Math.PI must survive the round trip)
const same = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) : a === b;

/**
 * Current editor scene as a SceneTemplate (src/constants/templates/*.json format): poses, conveyor turn/path/length,
 * floors (walls), doors, non-default settings, links by index, plus the loaded template's GLB props and lighting preset.
 * Loading the result with loadTemplate reproduces the scene (names regenerate as "<종류> <순번>").
 */
export function buildSceneTemplate(meta: { id?: string; name?: string; description?: string } = {}): SceneTemplate {
  const { objects, settings, links, props, lighting, autoConnect, camera: templateCamera } = useSceneStore.getState();
  // Camera defaults: this browser's view/bookmarks for the scope win, else the loaded template's shipped ones.
  const scope = bookmarkScope(props);
  const view = loadView(scope) ?? templateCamera?.view;
  const bookmarks = loadBookmarks(scope, templateCamera?.bookmarks);
  const camera = { ...(view ? { view } : {}), ...(bookmarks.some(Boolean) ? { bookmarks } : {}) };
  const equipment: TemplateEquipment[] = objects.map((o) => {
    const entry: TemplateEquipment = { kind: o.kind, x: round(o.x), z: round(o.z), yaw: round(o.yaw) };
    const out = entry as { -readonly [K in keyof TemplateEquipment]: TemplateEquipment[K] };
    if (o.conveyorTurn && o.conveyorTurn !== "straight") out.conveyorTurn = o.conveyorTurn;
    if (o.conveyorPath) out.conveyorPath = o.conveyorPath;
    if (o.conveyorLength) out.conveyorLength = round(o.conveyorLength);
    if (o.elevation) out.elevation = round(o.elevation);
    if (o.floor) out.floor = { ...o.floor };
    const defaults = settingsFor(o.kind) as Record<string, unknown>;
    const diff: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings[o.id] ?? {}))
      if (value !== undefined && !same(defaults[key], value)) diff[key] = typeof value === "number" ? round(value) : value;
    if (Object.keys(diff).length) out.settings = diff;
    return entry;
  });
  const index = new Map(objects.map((o, i) => [o.id, i]));
  const templateLinks: TemplateLink[] = [];
  for (const link of links) {
    const from = index.get(link.from), to = index.get(link.to);
    if (from !== undefined && to !== undefined) templateLinks.push({ type: link.type, from, to });
  }
  return {
    id: meta.id ?? "my-layout",
    name: meta.name ?? "내 레이아웃",
    description: meta.description ?? "에디터에서 저장한 레이아웃입니다.",
    ...(lighting ? { lighting } : {}),
    equipment,
    ...(templateLinks.length ? { links: templateLinks } : {}),
    ...(autoConnect ? {} : { autoConnect: false }),
    ...(props.length ? { props: props.map((p) => ({ ...p })) } : {}),
    ...(camera.view || camera.bookmarks ? { camera } : {}),
  };
}

/** Downloads the current scene as a template JSON; returns validation errors (empty = valid). */
export function downloadSceneTemplate() {
  const template = buildSceneTemplate();
  const errors = templateErrors(template);
  const json = JSON.stringify(template, null, 2).replace(/\n/g, "\r\n") + "\r\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  a.download = `scene-template-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if (errors.length) console.warn("[exportSceneTemplate] template validation:", errors);
  return errors;
}