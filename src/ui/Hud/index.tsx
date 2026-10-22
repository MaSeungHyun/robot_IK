import { useSceneStore } from "@/stores/useSceneStore";
import { useHudStore } from "@/stores/useHudStore";
import useEditorShortcuts from "@/hooks/useEditorShortcuts";
import ObjectPropertiesPanel from "@/ui/Hud/object/ObjectPropertiesPanel";
import LoadingOverlay from "@/ui/Hud/LoadingOverlay";
import Header from "@/ui/Header/index";
import PlacementErrors from "@/ui/Hud/asset/PlacementErrors";
import InspectorPanel from "@/ui/Hud/inspector/InspectorPanel";
import PanelColumn from "@/ui/Hud/_components/PanelColumn";
import FloorDrawingGuide from "@/ui/Hud/asset/FloorDrawingGuide";
import TrackingOverlay from "@/ui/Hud/TrackingOverlay";
import TrackingIndicator from "@/ui/tracking/TrackingIndicator";
import AssetRail from "@/ui/Hud/asset/AssetRail";
import ModalTransformHint from "@/ui/Hud/ModalTransformHint";
import LineOverviewPanel from "@/ui/Hud/line/LineOverviewPanel";
import EditorToolbar from "@/ui/Hud/editor/EditorToolbar";
import DashboardDialog from "@/ui/Hud/dashboard/full/DashboardDialog";
import AutoLayoutPanel from "@/ui/Hud/autoLayout/AutoLayoutPanel";
import { useAutoLayoutStore } from "@/stores/useAutoLayoutStore";

export default function Hud() {
  const editing = useSceneStore((state) => state.editing);
  const selected = useSceneStore((state) => state.selected);
  const inspectorTab = useHudStore((state) => state.inspectorTab);
  const autoLayoutOpen = useAutoLayoutStore((state) => state.open);
  const showEditor = editing;
  const showInspector = !showEditor && inspectorTab !== null;
  useEditorShortcuts(showEditor);

  return (
    <section
      aria-label="시뮬레이션 HUD"
      className="pointer-events-none absolute inset-0 z-40 flex flex-col overflow-hidden [&_.simulation-panel]:pointer-events-auto"
    >
      <Header />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="shadow" />
        {showEditor && <AssetRail />}
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden max-sm:flex-col">
          {showEditor && <EditorToolbar />}
          {showEditor && autoLayoutOpen && <AutoLayoutPanel />}
          {showEditor && !autoLayoutOpen && (
            <PanelColumn className="left-14">
              <PlacementErrors />
            </PanelColumn>
          )}
          {showEditor && selected && (
            <PanelColumn right>
              <ObjectPropertiesPanel />
            </PanelColumn>
          )}
          {showInspector && (
            <PanelColumn right>
              <InspectorPanel />
            </PanelColumn>
          )}
          {/* Edit mode owns the left side (AssetRail / placement errors); the line overview shows only outside it. */}
          {!showEditor && <LineOverviewPanel />}
          <LoadingOverlay />
          <TrackingOverlay />
          <TrackingIndicator />
        </div>
        {showEditor && <FloorDrawingGuide />}
        {showEditor && <ModalTransformHint />}
        <DashboardDialog />
      </div>
    </section>
  );
}
