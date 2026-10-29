import { useEffect, useMemo } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { QuadraticBezierCurve3, Vector3 } from "three";
import { useShallow } from "zustand/react/shallow";
import { selectedIds, useSceneStore } from "@/stores/useSceneStore";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import { LINKABLE_KINDS, type SceneLink } from "@/types/links";
import { linkOwner, mountedCarrier, resolveOwnedLink } from "@/viewport/editor/links/linkOwners";
import type { SceneEquipment } from "@/types/layout";
import { isSelectionClick } from "@/viewport/selection/isSelectionClick";
import { LINK_ACTIVE_COLOR, LINK_COLOR, linkPoint } from "@/viewport/editor/links/linkPoints";
import LinkMarkers from "@/viewport/editor/links/LinkMarkers";
import { LINK_FLOW_TIME, createLinkFlowMaterial, createRibbon, setLinkFlowColor, setLinkFlowState } from "@/viewport/editor/links/linkFlow";

const PATH_Y = 0.05;

/**
 * Edit-mode only (mounted by SceneEditor, so hidden while a run plays): link paths always, and in
 * link mode the interaction-point markers of linkable equipment, valid partners highlighted.
 */
export default function LinkOverlay() {
  const { objects, links, settings } = useSceneStore(useShallow((s) => ({ objects: s.objects, links: s.links, settings: s.settings })));
  const scene = useMemo(() => ({ objects, settings }), [objects, settings]);
  const { active, source, selectedLink } = useLinkModeStore(
    useShallow((s) => ({ active: s.active, source: s.source, selectedLink: s.selectedLink })),
  );
  // Every selected object (multi-select included); joined so the selector result is a stable string.
  const selectedKey = useSceneStore((s) => selectedIds(s).join("|"));
  const selected = useMemo(() => new Set(selectedKey ? selectedKey.split("|") : []), [selectedKey]);
  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const sourceObject = source ? byId.get(source) : undefined;
  // Link mode: badges of objects already linked to the source (or, before a source is picked, to the selection) turn orange.
  const linked = useMemo(() => {
    const anchors = source ? new Set([source]) : selected, out = new Set<string>();
    if (!anchors.size) return out;
    for (const link of links) {
      const ends = [[link.from, linkOwner(link.from, scene)], [link.to, linkOwner(link.to, scene)]] as const;
      const hit = (i: 0 | 1) => anchors.has(ends[i][0]) || anchors.has(ends[i][1]);
      if (hit(0)) { out.add(ends[1][0]); out.add(ends[1][1]); }
      if (hit(1)) { out.add(ends[0][0]); out.add(ends[0][1]); }
    }
    for (const id of anchors) out.delete(id);
    return out;
  }, [links, scene, source, selected]);
  // One uniform write per frame drives every link's flowing light.
  useFrame((_, delta) => { LINK_FLOW_TIME.value = (LINK_FLOW_TIME.value + Math.min(delta, 0.1)) % 1000; });

  return (
    <group>
      {links.map((link) => {
        // Links of a mounted pallet are drawn from/to its AMR; its own pickup link (AMR -> that pallet) is hidden.
        const fromId = linkOwner(link.from, scene), toId = linkOwner(link.to, scene);
        const from = byId.get(fromId), to = byId.get(toId);
        if (!from || !to || fromId === toId) return null;
        const touches = selected.has(link.from) || selected.has(link.to) || selected.has(fromId) || selected.has(toId);
        return <LinkPath key={link.id} link={link} from={from} to={to} selected={selectedLink === link.id} dim={selected.size > 0 && !touches} active={touches} />;
      })}
      {active && (
        <LinkMarkers
          markers={objects
            .filter((o) => LINKABLE_KINDS.has(o.kind) && !mountedCarrier(o.id, scene))
            .map((o) => ({
              object: o,
              isSource: o.id === source,
              valid: sourceObject ? o.id !== sourceObject.id && resolveOwnedLink(sourceObject, o, scene) !== null : true,
              picking: !!sourceObject,
              linked: linked.has(o.id),
            }))}
        />
      )}
    </group>
  );
}

/** `active`: the link touches a selected object; drawn in LINK_ACTIVE_COLOR (orange). */
function LinkPath({ link, from, to, selected, dim, active }: { link: SceneLink; from: SceneEquipment; to: SceneEquipment; selected: boolean; dim: boolean; active: boolean }) {
  const points = useMemo(() => {
    const a = linkPoint(from), b = linkPoint(to);
    const start = new Vector3(a.x, PATH_Y, a.z), end = new Vector3(b.x, PATH_Y, b.z);
    // Slight sideways bend so opposite or parallel links stay distinguishable.
    const mid = start.clone().lerp(end, 0.5), d = end.clone().sub(start);
    const control = mid.add(new Vector3(-d.z, 0, d.x).multiplyScalar(0.12));
    return new QuadraticBezierCurve3(start, control, end).getPoints(24);
  }, [from, to]);
  const arrow = useMemo(() => {
    const i = Math.floor(points.length / 2), p = points[i], q = points[i + 1] ?? p;
    return { position: p, yaw: Math.atan2(q.x - p.x, q.z - p.z) };
  }, [points]);
  const select = (event: ThreeEvent<MouseEvent>) => {
    if (!isSelectionClick(event)) return;
    event.stopPropagation();
    useLinkModeStore.getState().selectLink(link.id);
  };
  const ribbon = useMemo(() => createRibbon(points, 0.22), [points]);
  const color = active ? LINK_ACTIVE_COLOR : LINK_COLOR;
  const material = useMemo(() => createLinkFlowMaterial(LINK_COLOR), []);
  useEffect(() => setLinkFlowColor(material, color), [material, color]);
  useEffect(() => () => ribbon.geometry.dispose(), [ribbon]);
  useEffect(() => () => material.dispose(), [material]);
  const opacity = selected ? 1 : dim ? 0.25 : 0.75;
  useEffect(() => setLinkFlowState(material, opacity, ribbon.length, selected), [material, opacity, ribbon, selected]);
  return (
    <group>
      <mesh geometry={ribbon.geometry} material={material} renderOrder={2} frustumCulled={false} onClick={select} />
      <mesh position={arrow.position} rotation={[Math.PI / 2, 0, -arrow.yaw]} onClick={select}>
        <coneGeometry args={[0.07, 0.18, 12]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}