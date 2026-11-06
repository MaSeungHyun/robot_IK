import Icon from "@/components/Icon";
import { cn } from "@/lib/style";
import type { LinkType, SceneLink } from "@/types/links";
import { isForkliftRole, type EquipmentSettings, type SceneEquipment } from "@/types/layout";
import { linkOwner, ownedLinkEnds } from "@/viewport/editor/links/linkOwners";

/** Role class of an equipment for link guidance: AMR kinds split into pallet AMR / forklift / ship AMR / AGV; racks into fixed / mobile. */
type LinkClass = Exclude<SceneEquipment["kind"], "floor" | "door" | "rack"> | "forklift" | "ship" | "agv" | "rack" | "mobileRack";
type Scene = { objects: readonly SceneEquipment[]; settings: Record<string, EquipmentSettings | undefined> };

/** One relation the selected equipment can have: link type, side (out = this is `from`), the other end class and what it does. */
type Guide = { type: LinkType; dir: "out" | "in"; other: readonly LinkClass[]; label: string; text: string };

const CLASS_LABEL: Record<LinkClass, string> = {
  robot: "로봇", pallet: "팔레트 스테이션", conveyor: "컨베이어", amr: "AMR", dock: "도크·적치장", scanner: "스캐너",
  rack: "랙", mobileRack: "이동식 랙", rail: "레일", transfer: "트랜스퍼 리프트", forklift: "포크리프트", ship: "출하 AMR",
  agv: "AGV",
};

/** Every relation of LINK_RULES (plus the editor's AMR / forklift / ship / AGV orientation), seen from each class. */
const GUIDES: Partial<Record<LinkClass, readonly Guide[]>> = {
  amr: [
    { type: "feed", dir: "in", other: ["conveyor"], label: "컨베이어", text: "연결된 컨베이어의 물건을 받습니다." },
    { type: "load", dir: "in", other: ["robot"], label: "로봇", text: "연결된 로봇 근처로 가서 물건을 받습니다." },
    { type: "pickup", dir: "out", other: ["pallet"], label: "팔레트 스테이션", text: "연결된 팔레트 스테이션의 팔레트를 싣고 다닙니다." },
    { type: "emptyReturn", dir: "out", other: ["forklift"], label: "포크리프트", text: "연결된 포크리프트가 만재 교체(Rack_m·랙)와 빈 팔레트 회수를 담당합니다." },
    { type: "emptyReturn", dir: "out", other: ["dock"], label: "빈 팔레트 적치장", text: "빈 팔레트를 연결된 적치장에서 받습니다." },
    { type: "deliver", dir: "out", other: ["dock"], label: "도크", text: "만재 팔레트를 연결된 도크로 운반합니다." },
    { type: "deliver", dir: "out", other: ["rack"], label: "랙", text: "만재 팔레트를 연결된 랙으로 보냅니다." },
    { type: "deliver", dir: "out", other: ["conveyor"], label: "컨베이어", text: "만재 팔레트를 연결된 컨베이어로 보냅니다." },
    { type: "deliver", dir: "out", other: ["robot"], label: "로봇", text: "팔레트를 연결된 로봇에게 보냅니다." },
  ],
  forklift: [
    { type: "emptyReturn", dir: "in", other: ["amr"], label: "AMR", text: "연결된 AMR의 만재 교체와 빈 팔레트 회수를 담당합니다." },
    { type: "emptyReturn", dir: "out", other: ["dock"], label: "빈 팔레트 적치장", text: "연결된 적치장에서 빈 팔레트를 가져오고 회수한 팔레트를 쌓습니다." },
    { type: "store", dir: "out", other: ["mobileRack"], label: "이동식 랙", text: "연결된 이동식 랙(Rack_m)에 만재 팔레트를 적재합니다." },
    { type: "store", dir: "out", other: ["rack"], label: "랙", text: "연결된 고정 랙에 팔레트를 적재하고 출고합니다." },
    { type: "collect", dir: "in", other: ["transfer"], label: "트랜스퍼 리프트", text: "연결된 리프트가 내린 빈 팔레트를 회수합니다." },
  ],
  agv: [
    { type: "store", dir: "out", other: ["mobileRack"], label: "이동식 랙", text: "연결된 이동식 랙(Rack_m)을 견인해 rackDrop으로 운반합니다." },
  ],
  ship: [
    { type: "handoff", dir: "out", other: ["conveyor"], label: "컨베이어", text: "연결된 출하 컨베이어에 팔레트를 밀어 넣습니다." },
    { type: "pickup", dir: "out", other: ["pallet"], label: "팔레트 스테이션", text: "연결된 팔레트 스테이션의 팔레트를 싣고 다닙니다." },
  ],
  conveyor: [
    { type: "feed", dir: "out", other: ["robot"], label: "로봇", text: "연결된 로봇에게 물건을 공급합니다." },
    { type: "feed", dir: "out", other: ["amr"], label: "AMR", text: "연결된 AMR에게 물건을 넘겨줍니다." },
    { type: "feed", dir: "out", other: ["scanner"], label: "스캐너", text: "이 컨베이어의 AMR이 연결된 스캐너에서 하역합니다." },
    { type: "feed", dir: "out", other: ["rail"], label: "레일", text: "이 컨베이어의 AMR이 팔레트를 연결된 레일에 올립니다." },
    { type: "deliver", dir: "in", other: ["pallet", "amr"], label: "팔레트", text: "연결된 팔레트(AMR)의 만재 팔레트를 받습니다." },
    { type: "handoff", dir: "in", other: ["ship"], label: "출하 AMR", text: "연결된 출하 AMR이 팔레트를 밀어 넣습니다." },
  ],
  robot: [
    { type: "feed", dir: "in", other: ["conveyor"], label: "컨베이어", text: "연결된 컨베이어에서 물건을 집습니다." },
    { type: "load", dir: "out", other: ["pallet", "amr"], label: "팔레트·AMR", text: "연결된 팔레트(AMR 위 팔레트)에 물건을 적재합니다." },
    { type: "deliver", dir: "in", other: ["pallet", "amr"], label: "팔레트", text: "연결된 팔레트를 받습니다." },
  ],
  pallet: [
    { type: "load", dir: "in", other: ["robot"], label: "로봇", text: "연결된 로봇이 이 팔레트에 물건을 적재합니다." },
    { type: "pickup", dir: "in", other: ["amr", "ship"], label: "AMR", text: "연결된 AMR이 이 팔레트를 싣고 다닙니다." },
    { type: "deliver", dir: "out", other: ["dock"], label: "도크", text: "만재 팔레트를 연결된 도크로 보냅니다." },
    { type: "deliver", dir: "out", other: ["rack"], label: "랙", text: "만재 팔레트를 연결된 랙으로 보냅니다." },
    { type: "deliver", dir: "out", other: ["conveyor"], label: "컨베이어", text: "만재 팔레트를 연결된 컨베이어로 보냅니다." },
    { type: "deliver", dir: "out", other: ["robot"], label: "로봇", text: "팔레트를 연결된 로봇에게 보냅니다." },
    { type: "deliver", dir: "out", other: ["amr", "ship"], label: "AMR", text: "팔레트를 연결된 팔레트·출하 AMR에게 보냅니다." },
  ],
  scanner: [
    { type: "feed", dir: "in", other: ["conveyor"], label: "컨베이어", text: "연결된 컨베이어의 AMR이 여기서 하역합니다." },
  ],
  rail: [
    { type: "feed", dir: "in", other: ["conveyor"], label: "컨베이어", text: "연결된 컨베이어의 AMR이 팔레트를 이 레일에 올립니다." },
    { type: "distribute", dir: "out", other: ["transfer"], label: "트랜스퍼 리프트", text: "연결된 리프트로 팔레트를 분배합니다." },
  ],
  transfer: [
    { type: "distribute", dir: "in", other: ["rail"], label: "레일", text: "연결된 레일에서 팔레트를 받습니다." },
    { type: "collect", dir: "out", other: ["forklift"], label: "포크리프트", text: "내린 빈 팔레트를 연결된 포크리프트가 회수합니다." },
    { type: "collect", dir: "out", other: ["dock"], label: "빈 팔레트 적치장", text: "내린 빈 팔레트를 연결된 적치장에 쌓습니다." },
  ],
  dock: [
    { type: "deliver", dir: "in", other: ["pallet", "amr"], label: "팔레트", text: "연결된 팔레트(AMR)의 만재 팔레트를 받습니다." },
    { type: "emptyReturn", dir: "in", other: ["amr"], label: "AMR", text: "연결된 AMR·셔틀의 빈 팔레트 적치장으로 쓰입니다." },
    { type: "emptyReturn", dir: "in", other: ["forklift"], label: "포크리프트", text: "연결된 포크리프트가 빈 팔레트를 가져가고 쌓습니다." },
    { type: "collect", dir: "in", other: ["transfer"], label: "트랜스퍼 리프트", text: "연결된 리프트가 내린 빈 팔레트를 쌓습니다." },
  ],
  rack: [
    { type: "deliver", dir: "in", other: ["pallet", "amr"], label: "팔레트", text: "연결된 팔레트(AMR)의 만재 팔레트를 받습니다." },
    { type: "store", dir: "in", other: ["forklift"], label: "포크리프트", text: "연결된 포크리프트가 이 랙에 적재·출고합니다." },
  ],
  mobileRack: [
    { type: "store", dir: "in", other: ["forklift"], label: "포크리프트", text: "연결된 포크리프트가 이 이동식 랙에 만재 팔레트를 적재합니다." },
    { type: "store", dir: "in", other: ["agv"], label: "AGV", text: "연결된 AGV가 이 이동식 랙을 견인해 운반합니다." },
  ],
};

function classOf(o: SceneEquipment | undefined, settings: Scene["settings"]): LinkClass | null {
  if (!o || o.kind === "floor" || o.kind === "door") return null;
  if (o.kind === "rack") return settings[o.id]?.rackType === "mobile" ? "mobileRack" : "rack";
  if (o.kind !== "amr") return o.kind;
  const role = settings[o.id]?.amrRole;
  return isForkliftRole(role) ? "forklift" : role === "ship" ? "ship" : role === "agv" ? "agv" : "amr";
}

/** Linked rows: owner ids on the other end of `object`'s links matching each guide. */
function matches(object: SceneEquipment, links: readonly SceneLink[], scene: Scene, guide: Guide) {
  const ends = new Set(ownedLinkEnds(object.id, scene));
  const byId = new Map(scene.objects.map((o) => [o.id, o]));
  const out: string[] = [];
  for (const link of links) {
    if (link.type !== guide.type) continue;
    const mine = guide.dir === "out" ? link.from : link.to, other = guide.dir === "out" ? link.to : link.from;
    if (!ends.has(mine) || ends.has(other)) continue;
    const owner = linkOwner(other, scene);
    // A pallet mounted on an AMR acts as that AMR; either class counts.
    const classes = [classOf(byId.get(other), scene.settings), classOf(byId.get(owner), scene.settings)];
    if (!classes.some((c) => c && guide.other.includes(c))) continue;
    if (!out.includes(owner)) out.push(owner);
  }
  return out;
}

/** Link-editing guide: every relation the selected equipment can have, checked (primary) when a matching link exists. */
export default function LinkGuide({ object, links, scene }: { object: SceneEquipment; links: readonly SceneLink[]; scene: Scene }) {
  const cls = classOf(object, scene.settings);
  const guides = cls ? GUIDES[cls] : undefined;
  if (!guides?.length) return null;
  return (
    <div className="mb-2 border-b border-white/10 pb-2">
      <p className="mb-1 text-[11px] text-text-secondary">{CLASS_LABEL[cls!]} 연결 안내</p>
      <ul className="flex flex-col gap-1">
        {guides.map((guide) => {
          const linked = matches(object, links, scene, guide);
          const on = linked.length > 0;
          return (
            <li key={`${guide.type}:${guide.dir}:${guide.other.join(",")}`} className="flex items-start gap-1.5">
              <span
                aria-label={on ? "연결됨" : "연결 안 됨"}
                className={cn(
                  "mt-px flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                  on ? "border-brand-primary bg-brand-primary text-bg-primary" : "border-text-secondary/50 text-transparent",
                )}
              >
                <Icon icon="Check" aria-hidden="true" className="size-2.5" strokeWidth={3} />
              </span>
              <span className={cn("min-w-0 text-[11px] leading-4", on ? "text-text-primary" : "text-text-secondary")}>
                <span className={cn("font-medium", on && "text-brand-primary")}>{guide.label}</span>: {guide.text}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
