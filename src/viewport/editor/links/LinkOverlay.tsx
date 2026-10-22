import { useEffect, useMemo } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { QuadraticBezierCurve3, Vector3 } from "three";
import { useShallow } from "zustand/react/shallow";
import { useSceneStore } from "@/stores/useSceneStore";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import { LINKABLE_KINDS, resolveLink, type SceneLink } from "@/types/links";
import type { SceneEquipment } from "@/types/layout";
import { isSelectionClick } from "@/viewport/selection/isSelectionClick";
import { LINK_COLOR, linkPoint } from "@/viewport/editor/links/linkPoints";
import LinkMarkers from "@/viewport/editor/links/LinkMarkers";
import { LINK_FLOW_TIME, createLinkFlowMaterial, createRibbon, setLinkFlowState } from "@/viewport/editor/links/linkFlow";

const PATH_Y = 0.05;

/**
 * Edit-mode only (mounted by SceneEditor, so hidden while a run plays): link paths always, and in
 * link mode the interaction-point markers of linkable equipment, valid partners highlighted.
 */
export default function LinkOverlay() {
  const { objects, links } = useSceneStore(useShallow((s) => ({ objects: s.objects, links: s.links })));
  const { active, source, selectedLink } = useLinkModeStore(
    useShallow((s) => ({ active: s.active, source: s.source, selectedLink: s.selectedLink })),
  );
  const selected = useSceneStore((s) => s.selected);
  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const sourceObject = source ? byId.get(source) : undefined;
  // One uniform write per frame drives every link's flowing light.
  useFrame((_, delta) => { LINK_FLOW_TIME.value = (LINK_FLOW_TIME.value + Math.min(delta, 0.1)) % 1000; });

  return (
    <group>
      {links.map((link) => {
        const from = byId.get(link.from), to = byId.get(link.to);
        if (!from || !to) return null;
        const related = !selected || link.from === selected || link.to === selected;
        return <LinkPath key={link.id} link={link} from={from} to={to} selected={selectedLink === link.id} dim={!related} />;
      })}
      {active && (
        <LinkMarkers
          markers={objects
            .filter((o) => LINKABLE_KINDS.has(o.kind))
            .map((o) => ({
              object: o,
              isSource: o.id === source,
              valid: sourceObject ? o.id !== sourceObject.id && resolveLink(sourceObject, o) !== null : true,
              picking: !!sourceObject,
            }))}
        />
      )}
    </group>
  );
}

function LinkPath({ link, from, to, selected, dim }: { link: SceneLink; from: SceneEquipment; to: SceneEquipment; selected: boolean; dim: boolean }) {
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
  const material = useMemo(() => createLinkFlowMaterial(LINK_COLOR), []);
  useEffect(() => () => ribbon.geometry.dispose(), [ribbon]);
  useEffect(() => () => material.dispose(), [material]);
  const opacity = selected ? 1 : dim ? 0.25 : 0.75;
  useEffect(() => setLinkFlowState(material, opacity, ribbon.length, selected), [material, opacity, ribbon, selected]);
  return (
    <group>
      <mesh geometry={ribbon.geometry} material={material} renderOrder={2} frustumCulled={false} onClick={select} />
      <mesh position={arrow.position} rotation={[Math.PI / 2, 0, -arrow.yaw]} onClick={select}>
        <coneGeometry args={[0.07, 0.18, 12]} />
        <meshBasicMaterial color={LINK_COLOR} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}