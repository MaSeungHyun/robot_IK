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
      {
        kind: "robot",
        x: 0,
        z: -1.85,
        yaw: 0,
      },
      {
        kind: "robot",
        x: 0,
        z: 1.85,
        yaw: 0.523599,
      },
      {
        kind: "pallet",
        x: -1,
        z: -1.8,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: -1,
        z: 2,
        yaw: 0,
      },
      {
        kind: "conveyor",
        x: 1.06875,
        z: -1,
        yaw: 0,
      },
      {
        kind: "amr",
        x: -5,
        z: -2,
        yaw: 0,
      },
      {
        kind: "dock",
        x: -5.3,
        z: 2,
        yaw: 0,
      },
      {
        kind: "conveyor",
        x: 1.06875,
        z: 1.5,
        yaw: 0,
      },
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
  {
    id: "Template-01",
    name: "Template-01",
    description: "가상 공장을 구현합니다.",
    equipment: [
      {
        kind: "conveyor",
        x: 1.5,
        z: -2.7,
        yaw: 0,
        settings: {
          speed: 3,
          spawnInterval: 2,
        },
      },
      {
        kind: "floor",
        x: 0.5,
        z: 1.5,
        yaw: 0,
        floor: {
          width: 18,
          depth: 23,
          wallHeight: 6.5,
        },
      },
      {
        kind: "conveyor",
        x: 1.5,
        z: -0.2,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: 1.5,
        z: 2.3,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: 1.5,
        z: 4.8,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: 1.5,
        z: 7.3,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: 1.5,
        z: 9.8,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: -2.7,
        yaw: 0,
        settings: {
          speed: 3,
          spawnInterval: 2,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: -0.2,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: 2.3,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: 4.8,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: 7.3,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: 9.8,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: -2.5,
        yaw: 0,
        settings: {
          speed: 3,
          spawnInterval: 2,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: 0,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: 2.5,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: 5,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: 7.5,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: 10,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "robot",
        x: -4.6,
        z: -2.7,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "robot",
        x: -4.6,
        z: 1.3,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "robot",
        x: -4.5,
        z: 5.4,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "robot",
        x: -4.7,
        z: 9.5,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "robot",
        x: -0.2,
        z: -2.7,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "robot",
        x: -0.2,
        z: 1.5,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "robot",
        x: -0.2,
        z: 5.6,
        yaw: 0,
      },
      {
        kind: "robot",
        x: -0.2,
        z: 9.9,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "robot",
        x: 4.1,
        z: -2.8,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "robot",
        x: 3.9,
        z: 1.5,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "robot",
        x: 3.9,
        z: 5.8,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "robot",
        x: 4,
        z: 9.8,
        yaw: 0,
        settings: {
          speed: 3,
        },
      },
      {
        kind: "pallet",
        x: 4.1,
        z: -1.8,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: 0.1,
        z: -1.6,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: 4.1,
        z: 2.5,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: 4.1,
        z: 6.7,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: 4.1,
        z: 10.8,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: -0.1,
        z: 2.5,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: -0.1,
        z: 6.7,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: 0,
        z: 10.9,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: -4.7,
        z: 10.5,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: -4.6,
        z: 6.6,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: -4.6,
        z: 2.5,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: -4.6,
        z: -1.6,
        yaw: 0,
      },
      {
        kind: "dock",
        x: -5.2,
        z: -8.2,
        yaw: 0,
      },
      {
        kind: "dock",
        x: -1.8,
        z: -8.2,
        yaw: 0,
      },
      {
        kind: "dock",
        x: 2.3,
        z: -8.2,
        yaw: 0,
      },
      {
        kind: "dock",
        x: 5.9,
        z: -8.2,
        yaw: 0,
      },
      {
        kind: "amr",
        x: -4.9,
        z: -6,
        yaw: 0,
      },
      {
        kind: "amr",
        x: -1.5,
        z: -5.9,
        yaw: 0,
      },
      {
        kind: "amr",
        x: 2.5,
        z: -6,
        yaw: 0,
      },
      {
        kind: "amr",
        x: 6.2,
        z: -6,
        yaw: 0,
      },
      {
        kind: "scanner",
        x: -3,
        z: -3.7,
        yaw: 0,
      },
      {
        kind: "scanner",
        x: 1.5,
        z: -3.7,
        yaw: 0,
      },
      {
        kind: "scanner",
        x: 5.6,
        z: -3.7,
        yaw: 0,
      },
    ],
  },
] as const satisfies readonly SceneTemplate[];
