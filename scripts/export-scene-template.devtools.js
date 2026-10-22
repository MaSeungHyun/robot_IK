// DevTools console snippet (Vite dev server): dumps the current editor layout as a SceneTemplate
// JSON for src/constants/sceneTemplates.ts. Paste into the console of the running dev page.
// Round trip: export -> add to SCENE_TEMPLATES -> load reproduces kinds, poses, conveyor turns,
// floor/wall sizes and every non-default setting (defect rate, pick filter, pallet grade, dock/rack
// accept grade, belt/AMR speed, interval, capacity, reach, enabled, ...) and links (🔗), in internal units
// (beltSpeed/amrSpeed m/s, spawnInterval s, robot speed ×).
(async () => {
  const pick = (name) => {
    const urls = performance.getEntriesByType("resource").map((e) => e.name)
      .filter((u) => new URL(u).pathname === `/src/${name}`);
    return urls.at(-1) ?? `/src/${name}`;
  };
  const { useSceneStore, settingsFor, EQUIPMENT_NAMES } = await import(pick("stores/useSceneStore.ts"));
  const { objects, settings, links = [] } = useSceneStore.getState();

  const round = (v) => Math.round(v * 1e6) / 1e6;
  const same = (a, b) =>
    typeof a === "number" && typeof b === "number"
      ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
      : a === b;
  // Fields the template format (TemplateEquipment) carries; the rest is runtime or regenerated.
  const POSE = ["x", "z", "yaw"];
  const RUNTIME = new Set(["id", "name", "metadata"]);
  const lost = [];

  const equipment = objects.map((o, index) => {
    const entry = { kind: o.kind };
    for (const key of POSE) entry[key] = round(o[key]);
    if (o.conveyorTurn && o.conveyorTurn !== "straight") entry.conveyorTurn = o.conveyorTurn;
    if (o.floor) entry.floor = { ...o.floor };
    // Anything else on the object the loader would drop (future fields included).
    for (const [key, value] of Object.entries(o))
      if (!(key in entry) && !RUNTIME.has(key) && key !== "conveyorTurn" && value !== undefined)
        lost.push(`${o.id}.${key}`);
    // loadTemplate regenerates names as "<종류> <순번>" and drops metadata.
    if (o.name !== `${EQUIPMENT_NAMES[o.kind]} ${index + 1}`) lost.push(`${o.id}.name ("${o.name}")`);
    if (o.metadata !== undefined) lost.push(`${o.id}.metadata`);

    // Generic diff of every settings key against the loader's own defaults for this kind.
    const defaults = settingsFor(o.kind);
    const current = settings[o.id] ?? {};
    const diff = {};
    for (const [key, value] of Object.entries(current))
      if (value !== undefined && !same(defaults[key], value))
        diff[key] = typeof value === "number" ? round(value) : value;
    // A key the defaults set but this object lacks cannot be expressed (the loader merges defaults).
    for (const key of Object.keys(defaults))
      if (!(key in current)) lost.push(`${o.id}.settings.${key} (missing -> loads as default)`);
    if (Object.keys(diff).length) entry.settings = diff;
    return entry;
  });

  // Links (🔗) reference equipment by index in the exported array.
  const indexOf = new Map(objects.map((o, index) => [o.id, index]));
  const templateLinks = [];
  for (const link of links) {
    const from = indexOf.get(link.from), to = indexOf.get(link.to);
    if (from === undefined || to === undefined) lost.push(`link ${link.id} (${link.from} -> ${link.to})`);
    else templateLinks.push({ type: link.type, from, to });
  }
  const template = { id: "my-layout", name: "내 레이아웃", description: "개발 브라우저에서 저장한 레이아웃입니다.", equipment,
    ...(templateLinks.length ? { links: templateLinks } : {}) };
  const json = JSON.stringify(template, null, 2);
  try { copy(json); console.log("클립보드에 복사됨"); } catch { console.log("다운로드만 진행"); }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  a.download = `scene-template-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  const withSettings = equipment.filter((e) => e.settings).length;
  const defects = equipment.filter((e) => e.settings && ("defectRate" in e.settings || "grade" in e.settings || "pickFilter" in e.settings || "acceptGrade" in e.settings)).length;
  console.log(`${equipment.length}개 설비 · 연결 ${templateLinks.length}개 · 설정 변경 ${withSettings}개 · 불량 관련 설정 ${defects}개`, template);
  if (lost.length) console.warn("템플릿 형식으로 보존되지 않는 항목:", lost);
  return template;
})();