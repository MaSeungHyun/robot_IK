import type { BoxStage } from "@/domain/cargo/CargoRegistry";
export const BOX_STAGE_LABEL: Record<BoxStage, string> = {
  awaitingScan: "검사 대기",
  inboundAwaitingScan: "입하 하역 · 검사 대기",
  scannedNormal: "검사 통과 · 정상",
  scannedDefect: "검사 판정 · 불량",
  assigned: "로봇 집기 배정",
  held: "로봇 파지 중",
  palletizedNormal: "정상 팔레트 적재",
  palletizedDefect: "불량 팔레트 적재",
  inTransit: "팔레트 운반 중",
  stored: "랙 보관",
  outboundStaged: "출고 구역 대기",
  shipped: "출하 완료",
  passedUnprocessed: "라인 통과 (미처리)",
};
