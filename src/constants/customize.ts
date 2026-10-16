import type { FactoryLayout } from "../types/layout";

export const CUSTOMIZE_CONFIG={robotScale:.7,reach:1.8,navigationPadding:3,grid:.2,snap:.1,amrSpeed:.8,palletCapacity:20};
export const DEFAULT_LAYOUT:FactoryLayout={
  robot:{x:0,z:0,yaw:0},pallet:{x:-1.2,z:0,yaw:0},conveyor:{x:1.06875,z:0,yaw:0},
  amr:{x:-2.3,z:-1.8,yaw:0},dock:{x:-3.2,z:1.8,yaw:0},
};
export const EDITOR_HISTORY_LIMIT=100;
export const AMR_TRAFFIC={emptyRadius:.45,loadedRadius:.82,safetyMargin:.1};
