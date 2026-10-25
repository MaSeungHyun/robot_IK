/** AMR route line layers (AMR.tsx). */
// Wide, faint layers fake a glow around the bright core (no bloom pass);
// the dashed top layer's travelling pulses show the direction of travel.
export const AMR_PATH_LAYERS = [
  { color: "#0284c7", linewidth: 14, opacity: 0.14 },
  { color: "#02dfef", linewidth: 6, opacity: 0.45 },
  { color: "#f0f9ff", linewidth: 2.5, opacity: 0.7 },
  { color: "#7dd3fc", linewidth: 4, opacity: 0.9, dashed: true },
] as const;
/** Glow layer of the AMR route line (colour / opacity), shared with the auto-layout drop-in material. */
export const AMR_PATH_GLOW = AMR_PATH_LAYERS[1];
