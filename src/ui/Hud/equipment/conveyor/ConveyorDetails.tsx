import useEquipmentTelemetry from "@/hooks/useEquipmentTelemetry";
import { formatFixed, formatMetric } from "@/utils/equipment/formatMetric";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import { useMemo } from "react";
import Badge from "@/components/Badge";
import EquipmentDetailLayout from "@/ui/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import EquipmentNumberSetting from "@/ui/Hud/equipment/details/_components/EquipmentNumberSetting";
import EquipmentChoiceSetting from "@/ui/Hud/equipment/details/_components/EquipmentChoiceSetting";
import EquipmentToggleSetting from "@/ui/Hud/equipment/details/_components/EquipmentToggleSetting";
import EquipmentEnabledSetting from "@/ui/Hud/equipment/details/_components/EquipmentEnabledSetting";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { beltConnections, beltLength } from "@/domain/conveyor/conveyorLayout";
import { palletFeeds } from "@/domain/cycle/palletFeed";
import { SPEED_LIMITS } from "@/domain/simulation/equipmentSpeeds";
import type { ConveyorTurn } from "@/types/layout";
import ShuttleZoneSetting from "@/ui/Hud/equipment/conveyor/ShuttleZoneSetting";
import SmoothValue from "@/ui/Hud/equipment/details/_components/SmoothValue";
import { MOCK_TELEMETRY_CONFIG } from "@/constants/telemetry";
import { robotServesBelt } from "@/domain/amr/navigation/sceneValidation";

const metric = (value: number | undefined, unit: string) => (
  <SmoothValue value={value} format={(v) => formatFixed(v, unit)} intervalMs={MOCK_TELEMETRY_CONFIG.intervalMs} className="tabular-nums" />
);

const TURN_LABELS: Record<ConveyorTurn, string> = { straight: "직선", left: "좌회전", right: "우회전" };

export default function ConveyorDetails({ object }: EquipmentDetailProps) {
  const objects = useSceneStore((state) => state.objects);
  const enabled = useSceneStore((state) => state.settings[object.id]?.enabled);
  const autoSpawn = useSceneStore((state) => state.settings[object.id]?.autoSpawn);
  const selfUnload = useSceneStore((state) => state.settings[object.id]?.selfUnload);
  const inbound = useSceneStore((state) => state.settings[object.id]?.conveyorRole === "inbound");
  const palletUnit = useSceneStore((state) => state.settings[object.id]?.conveyorRole === "inbound");
  const settings = useSceneStore((state) => state.settings);
  const links = useSceneStore((state) => state.links);
  // Receiving AMR for pallet infeed: a shuttle AMR with a pallet on its deck, linked (🔗 공급) or parked near the belt end.
  const receiver = useMemo(() => {
    if (!inbound || !palletUnit) return null;
    const feedTo = (id: string) => links.filter((l) => l.type === "feed" && l.from === id).map((l) => l.to);
    const withPallet = new Set(objects.filter((o) => o.kind === "pallet" && settings[o.id]?.mountedOn).map((o) => settings[o.id]!.mountedOn!));
    const feeds = palletFeeds(objects.filter((o) => o.kind !== "amr" || withPallet.has(o.id)), settings, feedTo);
    const id = [...feeds].find(([, belt]) => belt.id === object.id)?.[0];
    return objects.find((o) => o.id === id) ?? null;
  }, [inbound, palletUnit, objects, settings, links, object.id]);
  const amrCount = useMemo(
    () => (inbound && palletUnit ? objects.filter((o) => o.kind === "amr" && !["forklift", "agv"].includes(settings[o.id]?.amrRole ?? "")).length : 0),
    [inbound, palletUnit, objects, settings],
  );
  // Every inbound flow must pass a robot: warn when the scene has none.
  const noRobot = useMemo(() => inbound && !objects.some((o) => o.kind === "robot"), [inbound, objects]);
  // Box outbound: a robot within reach depalletizes onto it; prompt to place one.
  const shipNoRobot = useMemo(() => settings[object.id]?.conveyorRole === "ship" && !robotServesBelt(object, objects, settings), [object, objects, settings]);
  const running = useSimulationStore((state) => state.running);
  const telemetry = useEquipmentTelemetry(object.id);

  const connections = useMemo(() => beltConnections(objects), [objects]);
  const incoming = connections.incoming.has(object.id);
  const previousId = Array.from(connections.next).find(([, next]) => next.id === object.id)?.[0];
  const previous = objects.find((candidate) => candidate.id === previousId);
  const next = connections.next.get(object.id);

  const status = (
    <Badge tone={!enabled ? "offline" : running ? "operating" : "idle"}>
      {!enabled ? "중지" : running ? "이송 중" : "일시 정지"}
    </Badge>
  );

  return (
    <EquipmentDetailLayout object={object} status={status} summary={
      <DetailRows rows={[
        { label: "구간 형태", value: TURN_LABELS[object.conveyorTurn ?? "straight"] },
        { label: "구간 길이", value: formatMetric(beltLength(object), "m", 2) },
        { label: "앞 구간", value: previous?.name ?? "없음 · 박스 생성 구간" },
        { label: "다음 구간", value: next?.name ?? "없음 · 라인 종료" },
        { label: "모터 온도", value: metric(telemetry?.motorTemperatureC, "°C") },
        { label: "소비 전력", value: metric(telemetry?.powerKw, "kW") },
        { label: "모터 부하 (모의)", value: metric(telemetry?.motorLoadPercent, "%"), progress: telemetry?.motorLoadPercent },
      ]} />
    } settings={
      <DetailSection title="컨베이어 설정">
        <EquipmentNumberSetting id={object.id} field="beltSpeed" label="연결 컨베이어 속도" unit="m/s" {...SPEED_LIMITS.beltSpeed} />
        <EquipmentChoiceSetting
          id={object.id}
          field="conveyorRole"
          label="용도"
          fallback="box"
          options={[
            { value: "box", label: "박스 투입" },
            { value: "inbound", label: "입하 (박스 / 팔레트 투입)" },
            { value: "fed", label: "로봇 투입 (자동 투입 없음)" },
            { value: "outbound", label: "출하 · 팔레트 전용 (AMR이 팔레트를 밀어 넣음)" },
            { value: "ship", label: "출하 · 박스 (로봇이 박스를 올림)" },
          ]}
          info="출하 컨베이어 종류: 팔레트 전용은 AMR 상부 롤러가 팔레트째 넘기고(로봇 불필요), 박스는 지게차가 둔 팔레트(또는 AMR 위 팔레트)에서 로봇이 박스를 하나씩 올립니다."
        />
        {shipNoRobot && <p style={{ color: "#f59e0b" }}>⚠ 박스 출하 컨베이어에는 로봇이 필요합니다. 로봇이 팔레트에서 박스를 내려 올리도록 컨베이어 옆(도달 거리 안)에 로봇을 배치하세요.</p>}
        {noRobot && <p style={{ color: "#f59e0b" }}>⚠ 입하 흐름에 로봇이 없습니다. 입하 박스·팔레트는 반드시 로봇을 거쳐야 합니다. 로봇을 배치하고 연결하세요.</p>}
        {inbound && (
          <p className="text-xs text-slate-500">입하는 적재 팔레트 단위로만 들어옵니다 (스캐너는 박스 단위 검사라 팔레트를 로봇이 풀어 올림).{" "}{palletUnit ? "적재 팔레트가 투입 간격마다 생성되어 컨베이어 끝(스토퍼)까지 이동합니다. AMR이 받는 위치에서 롤러로 넘겨받고, 다음 AMR은 앞 AMR이 작업을 마치고 받는 위치를 벗어난 뒤에 출발해 같은 각도로 정렬합니다. 받을 AMR이 없으면 스토퍼에서 컨베이어와 생성이 멈추고 뒤 팔레트도 간격을 두고 정지합니다. 받은 팔레트는 스캐너 라인 시작 로봇으로 운반되어 반드시 스캐너를 거칩니다." : ""}</p>
        )}
        {inbound && palletUnit && (
          <p style={{ color: receiver ? undefined : "#f59e0b" }}>
            {receiver ? `받는 AMR: ${receiver.name} (셔틀)` : amrCount ? `받는 AMR: 🔗 연결 AMR 우선, 없으면 가장 가까운 빈 AMR (${amrCount}대 대상)` : "⚠ 받을 AMR이 없습니다. 팔레트는 스토퍼에서 대기합니다. AMR을 🔗 공급으로 연결하거나 배치하세요."}
          </p>
        )}
        {inbound && palletUnit && <ShuttleZoneSetting id={object.id} />}
        {incoming ? <p>앞 구간에서 넘어오는 박스를 이송합니다.</p> : (
          <>
            <EquipmentToggleSetting id={object.id} field="autoSpawn" label="자동 생성" fallback />
            {autoSpawn !== false && (
              <EquipmentNumberSetting id={object.id} field="spawnInterval" label={inbound && palletUnit ? "팔레트 투입 간격" : "투입량"} unit={inbound && palletUnit ? "초" : "개/h"} {...SPEED_LIMITS.spawnInterval} />
            )}
            {!palletUnit && (
              <>
                <EquipmentToggleSetting id={object.id} field="selfUnload" label="AMR 자가 하역 (스캐너로 이어진 구간)" fallback />
                {selfUnload !== false && (
                  <EquipmentNumberSetting id={object.id} field="deckFeedInterval" label="자가 하역 박스 간격" unit="초" min={0.2} max={30} />
                )}
              </>
            )}
          </>
        )}
        <EquipmentEnabledSetting id={object.id} />
      </DetailSection>
    }>

    </EquipmentDetailLayout>
  );
}
