import { useShallow } from "zustand/react/shallow";
import Icon from "@/components/Icon";
import { cn } from "@/lib/style";
import { useSceneStore } from "@/stores/useSceneStore";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import { LINKABLE_KINDS, LINK_RULES } from "@/types/links";
import type { SceneEquipment } from "@/types/layout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";

/** '연결' section: links in and out of `object`; removable while editing. */
export default function LinkSection({ object }: { object: SceneEquipment }) {
  const { links, objects, editing, removeLink } = useSceneStore(
    useShallow((s) => ({ links: s.links, objects: s.objects, editing: s.editing, removeLink: s.removeLink })),
  );
  const selectedLink = useLinkModeStore((s) => s.selectedLink);
  const selectLink = useLinkModeStore((s) => s.selectLink);
  if (!LINKABLE_KINDS.has(object.kind)) return null;
  const own = links.filter((link) => link.from === object.id || link.to === object.id);
  const name = (id: string) => objects.find((o) => o.id === id)?.name ?? id;

  return (
    <DetailSection title="연결">
      {own.length === 0 ? (
        <p className="text-[11px] text-text-secondary">
          연결 없음 · 가까운 설비 기준으로 동작합니다.{editing && " 왼쪽 도구의 연결(L)로 추가하세요."}
        </p>
      ) : (
        <ul>
          {own.map((link) => {
            const outgoing = link.from === object.id;
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
                <span className="truncate text-[11px] text-text-primary" title={link.id}>{name(outgoing ? link.to : link.from)}</span>
                {editing ? (
                  <button
                    type="button"
                    aria-label={`${name(outgoing ? link.to : link.from)} 연결 해제`}
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