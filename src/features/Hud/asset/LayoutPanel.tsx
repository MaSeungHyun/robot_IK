import Panel from "@/features/Hud/_components/Panel";
import { useShallow } from "zustand/react/shallow";
import { useSceneStore } from "@/stores/useSceneStore";
import Button from "@/components/Button";

export default function LayoutPanel() {
  const { example, clear } = useSceneStore(
    useShallow((s) => ({
      example: s.example,
      clear: s.clear,
    })),
  );

  return (
    <Panel
      className="h-full flex-1"
      aria-label="사용자 배치"
    >
      <div className="mt-3">
        <Button onClick={example}>예제 배치</Button>
      </div>
      <Button onClick={clear}>Scene 비우기</Button>
    </Panel>
  );
}
