import { SCANNER_CONFIG } from "@/constants/scanner";
import type { EquipmentKind, EquipmentSettings } from "@/types/layout";

export type AssetPreset = {
  id: string;
  label: string;
  description: string;
  /** Applied on top of the default settings when the object is placed. */
  settings?: Partial<EquipmentSettings>;
  /** Accent for grade-specific presets. */
  tone?: "normal" | "defect";
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
    ],
  },
  {
    kind: "conveyor",
    icon: "Boxes",
    presets: [
      { id: "default", label: "기본", description: "시간당 450개(450개/h)를 투입합니다." },
      { id: "fast", label: "고빈도 투입", description: "시간당 1800개(1800개/h)를 투입합니다.", settings: { spawnInterval: 2 } },
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
      { id: "default", label: "기본", description: "완성 팔레트를 출고 구역·랙으로 운반합니다." },
      { id: "rack", label: "랙 반출 AMR", description: "랙에 적재된 팔레트를 무작위로 꺼내 문 밖으로 반출합니다.", settings: { amrRole: "rack" } },
    ],
  },
  {
    kind: "dock",
    icon: "MapPin",
    presets: [
      { id: "any", label: "전체", description: "모든 팔레트를 받습니다." },
      { id: "normal", label: "정상품 전용", description: "정상품 적재 팔레트만 받습니다.", settings: { acceptGrade: "normal" }, tone: "normal" },
      { id: "defect", label: "불량품 전용", description: "불량품 적재 팔레트만 받습니다.", settings: { acceptGrade: "defect" }, tone: "defect" },
    ],
  },
  {
    kind: "rack",
    icon: "Warehouse",
    presets: [
      { id: "any", label: "전체", description: "모든 팔레트를 보관합니다." },
      { id: "normal", label: "정상품 전용", description: "정상품 적재 팔레트만 보관합니다.", settings: { acceptGrade: "normal" }, tone: "normal" },
      { id: "defect", label: "불량품 전용", description: "불량품 적재 팔레트만 보관합니다.", settings: { acceptGrade: "defect" }, tone: "defect" },
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
export function thumbnailKey(kind: EquipmentKind, preset: AssetPreset) {
  if (kind === "floor") return null;
  if (kind === "dock") return preset.tone === "defect" ? "dock-defect" : "dock";
  if (kind === "door") return "door";
  return kind;
}
