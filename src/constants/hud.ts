export const WORKSPACE_MODES = [
  { id: "edit", label: "Edit", icon: "Pencil" },
  { id: "play", label: "Play", icon: "Play" },
] as const;

export const INSPECTOR_TABS = [
  { id: "equipments", label: "Equipments", icon: "Boxes" },
  { id: "details", label: "Details", icon: "Settings2" },
  { id: "dashboard", label: "Dashboard", icon: "ChartNoAxesCombined" },
] as const;

/** Header Sim Time readout: DOM write interval (~30 Hz) and max extrapolation past the last snapshot (s, x speed). */
export const HEADER_CLOCK = { updateMs: 33, maxExtrapolationS: 0.3 } as const;
