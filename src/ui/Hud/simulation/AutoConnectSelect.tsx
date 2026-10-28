import InfoTip from "@/components/InfoTip";
import Select from "@/components/Select";
import { useSceneStore } from "@/stores/useSceneStore";

const OPTIONS: readonly { value: "on" | "off"; label: string }[] = [
  { value: "on", label: "켜기" },
  { value: "off", label: "끄기" },
];

/** Global "자동 연결" (saved with the layout/template); editable in edit mode only. */
export default function AutoConnectSelect() {
  const autoConnect = useSceneStore((state) => state.autoConnect);
  const editing = useSceneStore((state) => state.editing);
  const setAutoConnect = useSceneStore((state) => state.setAutoConnect);
  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center text-xs text-text-secondary">자동 연결<InfoTip label="자동 연결 설명" text="🔗 링크가 없는 관계(공급·적재·픽업·배송·빈 팔레트 반납)를 가장 가까운 설비로 자동 연결합니다. 끄면 링크가 없는 설비는 동작하지 않고 '링크 없음' 경고를 띄웁니다. 링크가 있으면 항상 링크만 따르며, 링크 대상이 불가하면 다른 설비로 넘기지 않고 대기합니다. 편집 모드에서만 바꿀 수 있고 레이아웃과 함께 저장됩니다." /></p>
      <Select label="자동 연결" value={autoConnect ? "on" : "off"} options={OPTIONS} disabled={!editing} onValueChange={(value) => setAutoConnect(value === "on")} />
    </div>
  );
}
