// Editor pallet → AMR snap + undo/redo check (headless, through the real scene store).  node scripts/mount-check.mjs
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { useSceneStore } = await server.ssrLoadModule("/src/stores/useSceneStore.ts");
  const s = () => useSceneStore.getState();
  if (!s().editing) s().setEditing?.(true);
  s().add("amr", { x: 2, z: 3, yaw: 0.5 });
  const amr = s().objects.at(-1);
  s().add("pallet", { x: 2.4, z: 3.3, yaw: 0 });
  const pallet = s().objects.at(-1);
  const read = () => { const p = s().objects.find((o) => o.id === pallet.id); if (!p) return { gone: true, role: s().settings[amr.id]?.amrRole ?? null }; return { x: p.x, z: p.z, yaw: p.yaw, on: s().settings[pallet.id]?.mountedOn ?? null, role: s().settings[amr.id]?.amrRole ?? null }; };
  const out = [];
  const step = (label, ok) => { out.push(`${ok ? "OK  " : "FAIL"} ${label} ${JSON.stringify(read())}`); if (!ok) process.exitCode = 1; };
  let r = read(); step("snap on add", r.on === amr.id && r.x === 2 && r.z === 3 && r.yaw === 0.5 && r.role === "shuttle");
  s().updatePose(amr.id, { x: 5, z: 1 }); r = read(); step("follows AMR", r.x === 5 && r.z === 1);
  s().undo(); r = read(); step("undo AMR move", r.x === 2 && r.z === 3 && r.on === amr.id);
  s().redo(); r = read(); step("redo AMR move", r.x === 5 && r.z === 1);
  s().updatePose(pallet.id, { x: 9, z: 9 }); r = read(); step("unmount when moved away", r.on === null);
  s().undo(); r = read(); step("undo unmount", r.on === amr.id && r.x === 5);
  s().remove(amr.id); r = read(); step("remove AMR removes its pallet (none left on the floor)", r.gone === true);
  s().undo(); r = read(); step("undo remove", r.on === amr.id);
  // Shuttle preset: comes with a mounted deck pallet; '팔레트 포함' toggles it (one undo step each).
  s().setPending("amr", { amrRole: "shuttle" });
  s().add("amr", { x: -4, z: 2, yaw: 1 });
  const shuttle = s().objects.findLast((o) => o.kind === "amr");
  const deck = () => s().objects.filter((o) => o.kind === "pallet" && s().settings[o.id]?.mountedOn === shuttle.id);
  const check = (label, ok) => { out.push(`${ok ? "OK  " : "FAIL"} ${label} pallets=${deck().length}`); if (!ok) process.exitCode = 1; };
  let d = deck(); check("shuttle spawns with pallet", d.length === 1 && d[0].x === -4 && d[0].z === 2 && d[0].yaw === 1);
  s().undo(); check("undo shuttle add removes both", !s().objects.some((o) => o.id === shuttle.id) && deck().length === 0);
  s().redo(); check("redo shuttle add", deck().length === 1);
  s().setCarriedPallet(shuttle.id, false); check("팔레트 포함 off", deck().length === 0);
  s().undo(); check("undo off", deck().length === 1);
  s().setCarriedPallet(shuttle.id, false); s().setCarriedPallet(shuttle.id, true); check("팔레트 포함 on", deck().length === 1);
  s().updatePose(shuttle.id, { x: 0, z: 7 }); d = deck(); check("deck pallet follows shuttle", d[0]?.x === 0 && d[0]?.z === 7);
  // Role edits (details panel): a forklift / AGV role drops the deck pallet; undo restores role and mount.
  s().updateSettings(shuttle.id, { amrRole: "forklift" }); check("role → forklift releases pallet", deck().length === 0);
  s().undo(); check("undo role change", deck().length === 1 && s().settings[shuttle.id].amrRole === "shuttle");
  s().updateSettingsMany([shuttle.id], { amrRole: "agv" }); check("bulk role → agv releases pallet", deck().length === 0);
  s().undo(); check("undo bulk role", deck().length === 1);
  // Pallet/box AMR role: the deck pallet is deleted, never left on the floor.
  const pallets = () => s().objects.filter((o) => o.kind === "pallet").length;
  let before = pallets();
  s().updateSettings(shuttle.id, { amrRole: "pallet" }); check("role → 팔레트(박스) AMR deletes deck pallet", deck().length === 0 && pallets() === before - 1);
  s().undo(); check("undo restores deck pallet", deck().length === 1 && pallets() === before);
  // Ctrl+D / paste and array copies bring the deck pallet along.
  const copyId = s().duplicate(s().objects.find((o) => o.id === shuttle.id), s().settings[shuttle.id]);
  const onCopy = () => s().objects.filter((o) => o.kind === "pallet" && s().settings[o.id]?.mountedOn === copyId);
  check("duplicate copies deck pallet", onCopy().length === 1 && onCopy()[0].x === 0 && onCopy()[0].z === 7);
  s().undo(); check("undo duplicate removes both", onCopy().length === 0 && !s().objects.some((o) => o.id === copyId));
  before = pallets();
  const ids = s().arrayCopies(shuttle.id, [1, 1], { count: 3, gap: 0.5, axis: "x" });
  const riders = ids.filter((id) => s().objects.some((o) => o.kind === "pallet" && s().settings[o.id]?.mountedOn === id)).length;
  check(`array copies carry deck pallets (${ids.length} copies)`, ids.length > 0 && riders === ids.length && pallets() === before + ids.length);
  s().undo(); check("undo array copies", pallets() === before);
  console.log(out.join("\n"));
} finally { await server.close(); }
