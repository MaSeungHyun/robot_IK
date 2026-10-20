import Button from "@/components/Button";
import Icon from "@/components/Icon";
import Tabs from "@/components/Tabs";
import Panel from "@/features/Hud/_components/Panel";
import AssetPalette from "@/features/Hud/asset/AssetPalette";
import TemplateLibrary from "@/features/Hud/template/TemplateLibrary";
import LogPanel from "@/features/Hud/log/LogPanel";
import { useHudStore } from "@/stores/useHudStore";
import { useSceneStore } from "@/stores/useSceneStore";

export default function EditLibraryPanel() {
  const tab = useHudStore((state) => state.libraryTab);
  const setTab = useHudStore((state) => state.setLibraryTab);
  const close = useHudStore((state) => state.closeWorkspacePanel);
  const errors = useSceneStore((state) => state.errors);

  return (
    <Panel aria-label="배치 라이브러리" className="min-h-0 shrink overflow-hidden">
      {/* Fixed top: header, log status and placement errors never scroll. */}
      <div className="shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">라이브러리</h2>
          <Button
            aria-label="Edit 패널 닫기"
            className="size-6 px-0"
            onClick={close}
          >
            <Icon icon="X" />
          </Button>
        </div>
        <LogPanel />
        {errors.length > 0 && (
          <ul role="alert" className="mb-3 space-y-1 text-xs text-warning">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
      </div>
      {/* Tabs keep the tab bar fixed; only the active tab content scrolls. */}
      <Tabs
        label="배치 라이브러리 종류"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "asset", label: "Asset", content: <AssetPalette /> },
          {
            value: "template",
            label: "Template",
            content: <TemplateLibrary />,
          },
        ]}
      />
    </Panel>
  );
}
