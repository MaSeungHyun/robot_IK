import { DEFAULT_LAYOUT } from "@/constants/simulatorLayout";

import type { SceneTemplate } from "@/types/sceneTemplate";

export const SCENE_TEMPLATES = [
  {
    id: "palletizing",
    name: "기본 팔레타이징",
    description: "컨베이어의 박스를 로봇이 집어 팔레트에 적재합니다.",
    equipment: [
      { kind: "robot", x: 0, z: 0, yaw: 0 },
      { kind: "pallet", x: -1.15, z: 0, yaw: 0 },
      { kind: "conveyor", ...DEFAULT_LAYOUT.conveyor, settings: { spawnInterval: 5 } },
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
        settings: { spawnInterval: 5 },
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
        settings: { spawnInterval: 5 },
      },
    ],
  },
  {
    id: "inspection-line",
    name: "컨베이어 검사 라인",
    description: "연결된 벨트와 스캐너의 검사, 로봇 적재를 확인합니다.",
    equipment: [
      {
        kind: "conveyor",
        x: 1.5,
        z: -2.7,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "floor",
        x: 0.5,
        z: 1.5,
        yaw: 0,
        floor: {
          width: 20,
          depth: 30,
          wallHeight: 6.5,
        },
      },
      {
        kind: "conveyor",
        x: 1.5,
        z: -0.2,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: 1.5,
        z: 2.3,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: 1.5,
        z: 4.8,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: 1.5,
        z: 7.3,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: 1.5,
        z: 9.8,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: -2.7,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: -0.2,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: 2.3,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: 4.8,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: 7.3,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: 5.6,
        z: 9.8,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: -2.5,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: 0,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: 2.5,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: 5,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: 7.5,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "conveyor",
        x: -3,
        z: 10,
        yaw: 0,
        settings: {
          spawnInterval: 5,
          beltSpeed: 0.1875,
        },
      },
      {
        kind: "robot",
        x: -4.6,
        z: -2.7,
        yaw: 0,
        settings: {
          pickFilter: "defect",
        },
      },
      {
        kind: "robot",
        x: -4.6,
        z: 1.5,
        yaw: 0,
      },
      {
        kind: "robot",
        x: -4.6,
        z: 5.7,
        yaw: 0,
      },
      {
        kind: "robot",
        x: -4.7,
        z: 9.9,
        yaw: 0,
      },
      {
        kind: "robot",
        x: -0.2,
        z: -2.7,
        yaw: 0,
        settings: {
          pickFilter: "defect",
        },
      },
      {
        kind: "robot",
        x: -0.2,
        z: 1.5,
        yaw: 0,
      },
      {
        kind: "robot",
        x: -0.2,
        z: 5.7,
        yaw: 0,
      },
      {
        kind: "robot",
        x: -0.2,
        z: 9.9,
        yaw: 0,
      },
      {
        kind: "robot",
        x: 4.1,
        z: -2.7,
        yaw: 0,
        settings: {
          pickFilter: "defect",
        },
      },
      {
        kind: "robot",
        x: 3.9,
        z: 1.5,
        yaw: 0,
      },
      {
        kind: "robot",
        x: 3.9,
        z: 5.7,
        yaw: 0,
      },
      {
        kind: "robot",
        x: 4,
        z: 9.9,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: 4.1,
        z: -1.6,
        yaw: 0,
        settings: {
          grade: "defect",
        },
      },
      {
        kind: "pallet",
        x: 0,
        z: -1.6,
        yaw: 0,
        settings: {
          grade: "defect",
        },
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
        z: 10.9,
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
        z: 10.9,
        yaw: 0,
      },
      {
        kind: "pallet",
        x: -4.6,
        z: 6.7,
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
        settings: {
          grade: "defect",
        },
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
        settings: {
          acceptGrade: "defect",
        },
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
        settings: {
          acceptGrade: "defect",
        },
      },
      {
        kind: "amr",
        x: -5.2,
        z: -6,
        yaw: 0,
      },
      {
        kind: "amr",
        x: -1.8,
        z: -5.9,
        yaw: 0,
      },
      {
        kind: "amr",
        x: 2.3,
        z: -6,
        yaw: 0,
      },
      {
        kind: "amr",
        x: 5.9,
        z: -6,
        yaw: 0,
      },
      {
        kind: "scanner",
        x: -3,
        z: -3.7,
        yaw: 0,
        settings: {
          defectRate: 0.3,
        },
      },
      {
        kind: "scanner",
        x: 1.5,
        z: -3.7,
        yaw: 0,
        settings: {
          defectRate: 0.3,
        },
      },
      {
        kind: "scanner",
        x: 5.6,
        z: -3.7,
        yaw: 0,
        settings: {
          defectRate: 0.3,
        },
      },
      {
        kind: "rack",
        x: -3.9,
        z: 13.4,
        yaw: 0,
        settings: {
          acceptGrade: "normal",
        },
      },
      {
        kind: "rack",
        x: 0.8,
        z: 13.4,
        yaw: 0,
        settings: {
          acceptGrade: "normal",
        },
      },
      {
        kind: "rack",
        x: 5.6,
        z: 13.4,
        yaw: 0,
        settings: {
          acceptGrade: "normal",
        },
      },
    ],
  },
] as const satisfies readonly SceneTemplate[];
