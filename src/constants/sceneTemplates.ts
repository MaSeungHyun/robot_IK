import { DEFAULT_LAYOUT } from "@/constants/simulatorLayout";
import { CONVEYOR_LAYOUT } from "@/constants/conveyorLayoutConfig";
import type { SceneTemplate } from "@/types/sceneTemplate";

export const SCENE_TEMPLATES = [
  {
    id: "palletizing",
    name: "기본 팔레타이징",
    description: "컨베이어의 박스를 로봇이 집어 팔레트에 적재합니다.",
    equipment: [
      { kind: "robot", x: 0, z: 0, yaw: 0 },
      { kind: "pallet", x: -1.15, z: 0, yaw: 0 },
      { kind: "conveyor", ...DEFAULT_LAYOUT.conveyor },
    ],
  },
  {
    id: "robot-amr",
    name: "듀얼 로봇 + AMR",
    description: "두 로봇이 적재하고 AMR이 완료된 팔레트를 출고합니다.",
    equipment: [
      { kind: "robot", x: 0, z: -1.85, yaw: 0 },
      { kind: "robot", x: 0, z: 1.85, yaw: Math.PI / 6 },
      { kind: "pallet", x: -1.15, z: -0.85, yaw: 0 },
      { kind: "pallet", x: -1.15, z: 0.85, yaw: 0 },
      { kind: "conveyor", ...DEFAULT_LAYOUT.conveyor },
      { kind: "amr", x: -3, z: -2, yaw: 0 },
      { kind: "dock", x: -3, z: 2, yaw: 0 },
    ],
  },
  {
    id: "inspection-line",
    name: "컨베이어 검사 라인",
    description: "연결된 벨트와 스캐너의 검사, 로봇 적재를 확인합니다.",
    equipment: [
      { kind: "robot", x: 0, z: 0, yaw: 0 },
      { kind: "pallet", x: -1.15, z: 0, yaw: 0 },
      {
        kind: "conveyor",
        ...DEFAULT_LAYOUT.conveyor,
        z: -CONVEYOR_LAYOUT.length,
      },
      { kind: "conveyor", ...DEFAULT_LAYOUT.conveyor },
      {
        kind: "conveyor",
        ...DEFAULT_LAYOUT.conveyor,
        z: CONVEYOR_LAYOUT.length,
      },
      {
        kind: "scanner",
        ...DEFAULT_LAYOUT.scanner,
        z: -CONVEYOR_LAYOUT.length,
        settings: { defectRate: 0.1 },
      },
    ],
  },
] as const satisfies readonly SceneTemplate[];
