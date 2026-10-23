import { useSceneStore } from "@/stores/useSceneStore";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import { LINKABLE_KINDS, resolveLink } from "@/types/links";

/**
 * Link mode click on equipment `id`: the first click picks the source, a click on a valid partner
 * creates the link (or removes it when it already exists). The source stays picked so one robot can
 * be linked to several pallets in a row; clicking it again or an empty spot clears it.
 * The scene selection is left unchanged so the user can watch what gets linked to it (the source is
 * highlighted by the link-mode markers instead).
 */
export function pickLinkEnd(id: string) {
  const scene = useSceneStore.getState(), mode = useLinkModeStore.getState();
  const target = scene.objects.find((object) => object.id === id);
  if (!target || !LINKABLE_KINDS.has(target.kind)) return;
  const source = scene.objects.find((object) => object.id === mode.source);
  if (!source || source.id === id) {
    mode.setSource(source?.id === id ? null : id);
    return;
  }
  const link = resolveLink(source, target);
  if (!link) {
    mode.setSource(id);
    return;
  }
  const existing = scene.links.find((entry) => entry.type === link.type && entry.from === link.from && entry.to === link.to);
  if (existing) scene.removeLink(existing.id);
  else scene.addLink(link);
}