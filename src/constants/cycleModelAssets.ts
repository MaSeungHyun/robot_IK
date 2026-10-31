// AGV.glb / Rack_m.glb exist only in the optimized model set (meshopt + KTX2); resolve optionally.
const optional = (glob: Record<string, string>) => Object.values(glob)[0] as string | undefined;
export const agvModelUrl = optional(import.meta.glob<string>("/src/assets/models/AGV.glb", { query: "?url", import: "default", eager: true }));
export const rackMobileUrl = optional(import.meta.glob<string>("/src/assets/models/Rack_m.glb", { query: "?url", import: "default", eager: true }));
