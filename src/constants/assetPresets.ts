import { SCANNER_CONFIG } from "@/constants/scanner";
import type { EquipmentKind, EquipmentSettings } from "@/types/layout";

export type AssetPreset = {
  id: string;
  label: string;
  /** Flyout section title (grouped in order of first appearance). */
  section?: string;
  description: string;
  /** Applied on top of the default settings when the object is placed. */
  settings?: Partial<EquipmentSettings>;
  /** Accent for grade-specific presets. */
  tone?: "normal" | "defect";
  /** Thumbnail key override (ThumbnailBaker), e.g. role-specific models. */
  thumbnail?: string;
};

/** Asset rail categories (order = rail order, after Templates) and the preset cards each one offers. */
export const ASSET_PRESETS: { kind: EquipmentKind; icon: string; presets: AssetPreset[] }[] = [
  {
    kind: "robot",
    icon: "Bot",
    presets: [
      { id: "all", label: "전체 집기", description: "모든 박스를 집습니다." },
      { id: "normal", label: "정상품만", description: "정상 판정 박스만 집습니다.", settings: { pickFilter: "normal" }, tone: "normal" },
      { id: "defect", label: "불량품만", description: "불량 판정 박스만 집습니다.", settings: { pickFilter: "defect" }, tone: "defect" },
      { id: "depalletize", label: "하역 (디팔레타이징)", description: "하역 도크에 도착한 AMR 팔레트의 박스를 하나씩 가장 가까운 컨베이어(로봇 투입)에 올립니다.", settings: { robotRole: "depalletize" } },
    ],
  },
  {
    kind: "conveyor",
    icon: "Boxes",
    presets: [
      { id: "default", label: "기본", description: "시간당 450개(450개/h)를 투입합니다." },
      { id: "fast", label: "고빈도 투입", description: "시간당 1800개(1800개/h)를 투입합니다.", settings: { spawnInterval: 2 } },
      { id: "inbound", label: "입하 컨베이어", description: "입하 박스가 들어옵니다. 끝의 로봇이 AMR 위 팔레트에 쌓습니다.", settings: { conveyorRole: "inbound" }, thumbnail: "conveyor-inbound" },
      { id: "fed", label: "로봇 투입 컨베이어", description: "자동 투입 없이 하역 로봇이 올린 박스만 이송합니다 (스캐너 앞단).", settings: { conveyorRole: "fed" } },
      { id: "palletInbound", label: "팔레트 입하", description: "적재 팔레트 단위로 들어옵니다. 끝의 롤러 셔틀 AMR로 팔레트가 그대로 넘어갑니다.", settings: { conveyorRole: "inbound", inboundUnit: "pallet" }, thumbnail: "conveyor-inbound" },
      { id: "ship", label: "출하 라인", description: "스테이지에서 지게차가 올린 팔레트를 출하합니다 (자동 투입 없음).", settings: { conveyorRole: "ship" }, thumbnail: "conveyor-outbound" },
      { id: "outbound", label: "출하 컨베이어", description: "AMR이 시작점 앞 이송 지점에 서면 상부 롤러로 팔레트를 넘겨받아 끝까지 이송 후 출하합니다.", settings: { conveyorRole: "outbound" }, thumbnail: "conveyor-outbound" },
    ],
  },
  {
    kind: "scanner",
    icon: "ScanLine",
    presets: [
      { id: "default", label: "기본", description: `불량률 ${SCANNER_CONFIG.defaultDefectRate * 100}%` },
      { id: "strict", label: "불량 다발", description: "불량률 30%", settings: { defectRate: 0.3 }, tone: "defect" },
    ],
  },
  {
    kind: "pallet",
    icon: "Package",
    presets: [
      { id: "normal", label: "정상품 적재", description: "정상품을 받는 적재 위치입니다.", tone: "normal" },
      { id: "defect", label: "불량품 적재", description: "불량품을 받는 적재 위치입니다.", settings: { grade: "defect" }, tone: "defect" },
    ],
  },
  {
    kind: "amr",
    icon: "Truck",
    presets: [
      { id: "default", section: "AMR", label: "기본", description: "완성 팔레트를 출고 구역·랙으로 운반합니다." },
      { id: "shuttle", section: "AMR", label: "셔틀 AMR", description: "팔레트를 싣고 로봇 적재 위치와 서비스 도크를 오갑니다. 에디터에서 팔레트를 AMR 위에 놓으면 장착됩니다.", settings: { amrRole: "shuttle" }, thumbnail: "shuttle" },
      { id: "boxAmr", section: "AMR", label: "박스 AMR", description: "낱개 박스를 싣고 박스 컨베이어에서만 받습니다.", settings: { amrCargo: "box" } },
      { id: "agv", section: "AMR", label: "AGV (Rack_m 운반)", description: "Rack_m 아래로 들어가 들어 올려 랙 구역으로 옮깁니다.", settings: { amrRole: "agv" }, thumbnail: "agv" },
      { id: "forklift", section: "지게차", label: "지게차", description: "포크로 랙의 팔레트를 들어 꺼내 문 밖으로 반출합니다.", settings: { amrRole: "forklift" } },
      { id: "serviceForklift", section: "지게차", label: "서비스 지게차", description: "셔틀의 적재 팔레트를 Rack_m에 싣고 빈 팔레트를 셔틀에 올립니다.", settings: { amrRole: "forklift", forkliftTask: "service" } },
      { id: "rackForklift", section: "지게차", label: "랙 지게차", description: "Rack_m의 팔레트를 랙에 보관하고 랙에서 출하 스테이지로 꺼냅니다.", settings: { amrRole: "forklift", forkliftTask: "rack" } },
      { id: "carrierForklift", section: "지게차", label: "운반 지게차", description: "포크 앞 팔레트를 든 채 로봇 적재를 받고, 다 차면 하역 로봇 옆으로 운반한 뒤 빈 팔레트를 되가져옵니다.", settings: { amrRole: "forklift", forkliftTask: "carrier" } },
    ],
  },
  {
    kind: "dock",
    icon: "MapPin",
    presets: [
      { id: "palletSource", label: "빈 팔레트 적치장", description: "빈 팔레트 스택. 지게차가 여기서 빈 팔레트를 집고 회수한 빈 팔레트를 쌓습니다. (하역·교체·출고 위치는 로봇/지게차/AMR 설정에서 바닥 클릭으로 지정)", settings: { dockRole: "palletSource" }, thumbnail: "dock-palletSource" },
    ],
  },
  {
    kind: "rack",
    icon: "Warehouse",
    presets: [
      { id: "any", label: "전체", description: "모든 팔레트를 보관합니다." },
      { id: "normal", label: "정상품 전용", description: "정상품 적재 팔레트만 보관합니다.", settings: { acceptGrade: "normal" }, tone: "normal" },
      { id: "defect", label: "불량품 전용", description: "불량품 적재 팔레트만 보관합니다.", settings: { acceptGrade: "defect" }, tone: "defect" },
      { id: "mobile", label: "Rack_m (이동식)", description: "서비스 지게차가 채우고 AGV가 들어 옮기는 이동식 랙입니다. 고정 랙과 별개 오브젝트입니다.", settings: { rackType: "mobile" }, thumbnail: "rack-mobile" },
    ],
  },
  {
    kind: "door",
    icon: "DoorOpen",
    presets: [
      { id: "closed", label: "롤러 셔터 (닫힘)", description: "4 × 4.5 m. 벽 근처(0.5 m)에 놓으면 벽에 붙고 개구부가 뚫립니다." },
      { id: "open", label: "롤러 셔터 (열림)", description: "열린 상태로 시작합니다.", settings: { doorOpen: true } },
    ],
  },
  {
    kind: "floor",
    icon: "BrickWall",
    presets: [{ id: "default", label: "바닥/벽", description: "바닥을 드래그해 영역 지정 → 마우스로 벽 높이 → 클릭 확정 (Esc: 벽 없이 확정)" }],
  },
];

/** Key into the baked thumbnails (ThumbnailBaker); null = no model (drawn as an icon). */
/** Thumbnail key of a placed object (info panel), from its kind and role settings; matches the asset cards. */
export function objectThumbnailKey(kind: EquipmentKind, settings?: Partial<EquipmentSettings>) {
  if (kind === "floor") return null;
  if (kind === "amr" && (settings?.amrRole === "forklift" || settings?.amrRole === "rack")) return "forklift";
  if (kind === "amr" && (settings?.amrRole === "agv" || settings?.amrRole === "shuttle")) return settings.amrRole;
  if (kind === "rack" && settings?.rackType === "mobile") return "rack-mobile";
  if (kind === "conveyor" && settings?.conveyorRole === "ship") return "conveyor-outbound";
  if (kind === "conveyor" && (settings?.conveyorRole === "inbound" || settings?.conveyorRole === "outbound")) return `conveyor-${settings.conveyorRole}`;
  if (kind === "dock" && settings?.dockRole && settings.dockRole !== "ship") return `dock-${settings.dockRole}`;
  if (kind === "dock") return settings?.dockRole === "unload" ? "dock-unload" : settings?.acceptGrade === "defect" ? "dock-defect" : "dock";
  return kind;
}
export function thumbnailKey(kind: EquipmentKind, preset: AssetPreset) {
  if (kind === "floor") return null;
  if (preset.thumbnail) return preset.thumbnail;
  if (kind === "amr" && preset.settings?.amrRole === "forklift") return "forklift";
  if (kind === "dock") return preset.tone === "defect" ? "dock-defect" : "dock";
  if (kind === "door") return "door";
  return kind;
}
