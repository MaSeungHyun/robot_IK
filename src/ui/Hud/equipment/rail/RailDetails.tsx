import Badge from "@/components/Badge";
import { RAIL_CONFIG, TRANSFER_CONFIG } from "@/constants/railTransfer";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import EquipmentDetailLayout from "@/ui/Hud/equipment/details/_components/EquipmentDetailLayout";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";

/** rail_condition: AMR drops a pallet at the centre, the rail sends it to a free end lift (🔗 공급: 컨베이어 → 레일). */
export function RailDetails({ object }: EquipmentDetailProps) {
  return (
    <EquipmentDetailLayout
      object={object}
      status={<Badge tone="idle">레일</Badge>}
      summary={
        <DetailRows rows={[
          { label: "형식", value: "팔레트 분배 롤러 레일" },
          { label: "길이", value: `${(RAIL_CONFIG.halfLength * 2).toFixed(1)} m` },
          { label: "투입", value: "가운데 (AMR) → 양 끝 리프트로 1개씩" },
          { label: "연결", value: "🔗 공급: 입하 컨베이어 → 레일" },
        ]} />
      }
    />
  );
}

/** Transfer_Forklift: holds the pallet for the robot, lowers the empty one for a forklift, then returns. */
export function TransferDetails({ object }: EquipmentDetailProps) {
  return (
    <EquipmentDetailLayout
      object={object}
      status={<Badge tone="idle">리프트</Badge>}
      summary={
        <DetailRows rows={[
          { label: "형식", value: "레일 끝 트랜스퍼 리프트 (양쪽 스토퍼)" },
          { label: "하강", value: `수직 ${TRANSFER_CONFIG.downY.toFixed(2)} m (위·아래만)` },
          { label: "빈 팔레트", value: "🔗 빈 팔레트 회수: 리프트 → 지게차/적치장 (없으면 가장 가까운 곳)" },
        ]} />
      }
    />
  );
}
