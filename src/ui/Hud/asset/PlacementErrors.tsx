import Panel from "@/ui/Hud/_components/Panel";
import { useSceneStore } from "@/stores/useSceneStore";

/** Layout validation errors (e.g. after PLAY was refused), shown while editing. */
export default function PlacementErrors() {
  const errors = useSceneStore((state) => state.errors);
  if (!errors.length) return null;
  return (
    <Panel aria-label="배치 오류" className="p-3">
      <h2 className="mb-2 text-xs font-semibold text-warning">배치 오류</h2>
      <ul role="alert" className="space-y-1 text-xs text-warning">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </Panel>
  );
}
