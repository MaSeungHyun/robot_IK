import InfoTip from "@/components/InfoTip";
import { useShallow } from "zustand/react/shallow";
import Icon from "@/components/Icon";
import { cn } from "@/lib/style";
import { useSceneStore } from "@/stores/useSceneStore";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import { LINKABLE_KINDS, LINK_RULES } from "@/types/links";
import type { SceneEquipment } from "@/types/layout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import { linkOwner, mountedCarrier, ownedLinkEnds } from "@/viewport/editor/links/linkOwners";

/** '연결' section: links in and out of `object`; removable while editing. */
export default function LinkSection({ object }: { object: SceneEquipment }) {
  const { links, objects, settings, editing, removeLink } = useSceneStore(
    useShallow((s) => ({ links: s.links, objects: s.objects, settings: s.settings, editing: s.editing, removeLink: s.removeLink })),
  );
  const selectedLink = useLinkModeStore((s) => s.selectedLink);
  const selectLink = useLinkModeStore((s) => s.selectLink);
  if (!LINKABLE_KINDS.has(object.kind)) return null;
  const scene = { objects, settings };
  const carrier = mountedCarrier(object.id, scene);
  const name = (id: string) => objects.find((o) => o.id === id)?.name ?? id;
  if (carrier)
    return (
      <DetailSection title="연결">
        <p className="flex items-center text-[11px] text-text-secondary">AMR에 실린 팔레트<InfoTip label="실린 팔레트 설명" text={`AMR에 실린 팔레트는 ${name(carrier)}의 연결을 따릅니다.`} /></p>
      </DetailSection>
    );
  // An AMR also lists its mounted pallet's links (shown as its own), minus the pickup of that pallet.
  const ends = new Set(ownedLinkEnds(object.id, scene));
  const own = links.filter((link) => (ends.has(link.from) || ends.has(link.to)) && linkOwner(link.from, scene) !== linkOwner(link.to, scene));

  return (
    <DetailSection title="연결">
      {own.length === 0 ? (
        <p className="text-[11px] text-text-secondary">
          연결 없음 · 가까운 설비 기준으로 동작합니다.{editing && " 왼쪽 도구의 연결(L)로 추가하세요."}
        </p>
      ) : (
        <ul>
          {own.map((link) => {
            const outgoing = ends.has(link.from);
            return (
              <li
                key={link.id}
                className={cn(
                  "grid min-h-5 grid-cols-[40%_minmax(0,1fr)_auto] items-center gap-2 py-px",
                  selectedLink === link.id && "text-brand-primary",
                )}
              >
                <button type="button" className="truncate text-left text-[11px] text-text-secondary" onClick={() => selectLink(link.id)}>
                  {LINK_RULES[link.type].label} {outgoing ? "→" : "←"}
                </button>
                <span className="truncate text-[11px] text-text-primary" title={link.id}>{name(linkOwner(outgoing ? link.to : link.from, scene))}</span>
                {editing ? (
                  <button
                    type="button"
                    aria-label={`${name(linkOwner(outgoing ? link.to : link.from, scene))} 연결 해제`}
                    title="연결 해제"
                    className="flex size-4 items-center justify-center rounded-[3px] text-text-secondary hover:bg-white/10 hover:text-text-primary"
                    onClick={() => removeLink(link.id)}
                  >
                    <Icon icon="X" aria-hidden="true" className="size-3" />
                  </button>
                ) : <span />}
              </li>
            );
          })}
        </ul>
      )}
    </DetailSection>
  );
}