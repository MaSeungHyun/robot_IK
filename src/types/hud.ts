import type { INSPECTOR_TABS, WORKSPACE_MODES } from "@/constants/hud";

export type WorkspaceMode = (typeof WORKSPACE_MODES)[number]["id"];
export type InspectorTab = (typeof INSPECTOR_TABS)[number]["id"];

