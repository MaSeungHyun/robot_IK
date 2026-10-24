import { CONVEYOR_LAYOUT as BELT } from "@/constants/conveyorLayoutConfig";
import { SCAN_TUNNEL, scanTunnelPose } from "@/domain/conveyor/scanTunnel";
import { LAYOUT_RULES as R } from "@/domain/layout/autoLayout";
import { STREAM_CONFIG } from "@/constants/simulation";
import { AMR_TRAFFIC } from "@/constants/simulatorLayout";
import type { EquipmentSettings } from "@/types/layout";
import type { SceneTemplate, TemplateEquipment } from "@/types/sceneTemplate";

/*
 * Every line is one rail.glb (BELT.length at authored size) headed by a ScanTunnel standing over its start;
 * robots sit beside the belt after the tunnel exit at LAYOUT_RULES spacing. Links are omitted: the simulator's
 * distance-based fallback gives the same relations (each robot <- its own chain, pallet <- nearest robot).
 */
type Settings = Partial<EquipmentSettings>;
type Slot = {
  /** Distance past the tunnel exit along the belt (m). */
  at: number;
  /** -1: robot on the belt's local -x side, +1: local +x side. */
  side?: -1 | 1;
  /** Pallet downstream of the robot (same side) instead of further out. */
  along?: boolean;
  robot?: Settings;
  pallet?: Settings;
};
const round = (v: number) => +v.toFixed(4);
/** One straight line starting at `start` (belt entry, flowing along local +z of `start.yaw`). */
function line(start: { x: number; z: number; yaw: number }, spawnInterval: number, slots: Slot[], scanner: Settings = { defectRate: 0 }): TemplateEquipment[] {
  const s = Math.sin(start.yaw), c = Math.cos(start.yaw);
  const at = (d: number, lateral: number) => ({ x: round(start.x + lateral * c + d * s), z: round(start.z - lateral * s + d * c), yaw: start.yaw });
  const belt = { kind: "conveyor", ...at(BELT.length / 2, 0), settings: { spawnInterval } } as const;
  const tunnel = scanTunnelPose(belt);
  const out: TemplateEquipment[] = [belt, { kind: "scanner", x: round(tunnel.x), z: round(tunnel.z), yaw: start.yaw, settings: scanner }];
  for (const slot of slots) {
    const d = SCAN_TUNNEL.exitDistance + slot.at, side = slot.side ?? -1, lateral = side * R.beltToRobot;
    out.push({ kind: "robot", ...at(d, lateral), ...(slot.robot && { settings: slot.robot }) });
    const pallet = slot.along ? at(d + R.robotToPallet, lateral) : at(d, lateral + side * R.robotToPallet);
    out.push({ kind: "pallet", ...pallet, ...(slot.pallet && { settings: slot.pallet }) });
  }
  return out;
}
const firstSlot = R.robotPitch / 2;
const rack = (x: number, z: number, settings?: Settings): TemplateEquipment => ({ kind: "rack", x, z, yaw: Math.PI / 2, ...(settings && { settings }) });

/** Inspection line: three lines along x, tunnels at z = -4.5, 4 robot cells each (pallet outboard: an AMR body beside a
 *  downstream pallet would hit the belt), first cell takes defects. */
const INSPECTION_X = [-3.6, 4, 11.6];
/** AMR aisle x of an inspection line: just outside its pallet column (pallets in one column block travel along it). */
const inspectionAisleX = (x: number) => round(x - R.beltToRobot - R.robotToPallet - STREAM_CONFIG.palletWidth / 2 - AMR_TRAFFIC.loadedRadius - AMR_TRAFFIC.safetyMargin);
const inspectionLine = (x: number) =>
  line({ x, z: -4.5, yaw: 0 }, 5, [0, 1, 2, 3].map((k) => ({
    at: firstSlot + k * R.robotPitch,
    pallet: k === 0 ? { capacity: 3, grade: "defect" as const } : { capacity: 3 },
    ...(k === 0 && { robot: { pickFilter: "defect" as const } }),
  })), { defectRate: 0.3 });
const normal = { acceptGrade: "normal" as const };

/** Suitable design: four lines flowing -x in back-to-back pairs (inner) and wall lines (outer). */
const SUITABLE_YAW = Math.PI * 1.5, SUITABLE_START = 13, innerZ = BELT.width / 2 + 0.05, wallZ = 10.6;
/** AMR aisle between the inner and wall pallet rows. */
const aisleZ = round((innerZ + wallZ) / 2);
const suitableLine = (z: number, side: -1 | 1) =>
  line({ x: SUITABLE_START, z, yaw: SUITABLE_YAW }, 7.438, [0, 1].map((k) => ({ at: firstSlot + k * R.robotPitch, side })));

/** Inspection-style cells along one line: `count` robots from the first slot, pallets outboard. */
const cells = (count: number, first: (k: number) => Partial<Slot> = () => ({})) =>
  Array.from({ length: count }, (_, k) => ({ at: firstSlot + k * R.robotPitch, ...first(k) }));
/** Belt centre -> AMR aisle centre of an inspection-style line (pallets outboard, aisle just past them). */
const AISLE_OFFSET = round(-inspectionAisleX(0));
/** Rack rows on the aisle side, each facing the line start (-z) with an access gap in front (rack depth + standoff + AMR). */
const RACK_ROWS = [0, 6, 12];
/** Rack columns outward from `x` (direction `dir`): first column clears the AMR aisle, columns 4.9 m apart. */
const rackBlock = (x: number, dir: -1 | 1, columns: number, settings?: Settings) =>
  Array.from({ length: columns }, (_, c) => x + dir * (5 + c * 4.9)).flatMap((rx) => RACK_ROWS.map((z) => rack(rx, z, settings)));
const forklift = (x: number, z: number): TemplateEquipment => ({ kind: "amr", x, z, yaw: 0, settings: { amrRole: "forklift" } });

export const SCENE_TEMPLATES: readonly SceneTemplate[] = [
  {
    id: "palletizing",
    name: "기본 팔레타이징",
    description: "컨베이어의 박스를 로봇이 집어 팔레트에 적재합니다.",
    equipment: line({ x: R.beltToRobot, z: -(SCAN_TUNNEL.exitDistance + firstSlot), yaw: 0 }, 5, [{ at: firstSlot }]),
  },
  {
    id: "robot-amr",
    name: "듀얼 로봇 + AMR",
    description: "두 로봇이 적재하고 AMR이 완료된 팔레트를 출고합니다.",
    equipment: [
      ...line({ x: R.beltToRobot, z: -(SCAN_TUNNEL.exitDistance + R.robotPitch), yaw: 0 }, 5, [{ at: firstSlot }, { at: firstSlot + R.robotPitch }]),
      { kind: "amr", x: -5, z: -2, yaw: 0 },
      { kind: "dock", x: -5.3, z: 2, yaw: 0 },
    ],
  },
  {
    id: "inspection-line",
    name: "컨베이어 검사 라인",
    description: "연결된 벨트와 스캐너의 검사, 로봇 적재를 확인합니다.",
    equipment: [
      ...INSPECTION_X.flatMap(inspectionLine),
      ...INSPECTION_X.map((x, i) => ({ kind: "dock", x: inspectionAisleX(x), z: -9, yaw: 0, ...(i === 1 && { settings: { acceptGrade: "defect" as const } }) }) as TemplateEquipment),
      { kind: "dock", x: 15.2, z: -9, yaw: 0, settings: { acceptGrade: "defect" } },
      ...INSPECTION_X.map((x) => ({ kind: "amr", x: inspectionAisleX(x), z: -6.4, yaw: 0 }) as TemplateEquipment),
      { kind: "amr", x: 15.2, z: -6.4, yaw: 0, settings: { amrRole: "forklift" } },
      ...[19, 23.9, 28.8].flatMap((x) => [-3.45, -1.5, 5, 6.95, 13.45, 15.4].map((z) => rack(x, z, normal))),
      { kind: "floor", x: 11.5, z: 7.5, yaw: 0, floor: { width: 44, depth: 35, wallHeight: 6.5 } },
      { kind: "door", x: 4.8, z: 25, yaw: Math.PI },
      { kind: "door", x: -3.2, z: 25, yaw: Math.PI },
    ],
  },
  {
    id: "suitable-design-01",
    name: "적합 설계 01",
    description: "추천 설게를 통한 레이아웃입니다.",
    equipment: [
      ...suitableLine(-innerZ, -1),
      ...suitableLine(-wallZ, 1),
      ...suitableLine(wallZ, -1),
      ...suitableLine(innerZ, 1),
      ...[-18.5, -24.4].flatMap((x) => [-6.5, 0, 6.5].map((z) => rack(x, z))),
      { kind: "dock", x: 13.77, z: -aisleZ, yaw: SUITABLE_YAW },
      { kind: "amr", x: 11, z: aisleZ, yaw: SUITABLE_YAW },
      { kind: "amr", x: 11, z: -aisleZ, yaw: SUITABLE_YAW },
      { kind: "amr", x: 8.2, z: -aisleZ, yaw: SUITABLE_YAW },
      { kind: "floor", x: -4, z: 0, yaw: 0, floor: { width: 44, depth: 24, wallHeight: 6 } },
      { kind: "door", x: -26, z: 4, yaw: Math.PI / 2 },
      { kind: "door", x: -26, z: -4, yaw: Math.PI / 2 },
      { kind: "amr", x: -5.2, z: 3.25, yaw: -Math.PI / 2, settings: { amrRole: "forklift" } },
    ],
  },
  {
    id: "compact-forklift-storage",
    name: "소형 단일 라인 + 지게차 보관",
    description: "한 라인의 로봇 3대가 적재하고, AMR이 랙 앞까지 옮긴 팔레트를 지게차가 랙에 보관합니다.",
    equipment: [
      ...line({ x: 0, z: -4.5, yaw: 0 }, 5, cells(3)),
      { kind: "amr", x: inspectionAisleX(0), z: -6.4, yaw: 0 },
      forklift(-AISLE_OFFSET - 7.4, -6.4),
      ...rackBlock(-AISLE_OFFSET, -1, 2),
      { kind: "floor", x: -7, z: 6, yaw: 0, floor: { width: 26, depth: 36, wallHeight: 6 } },
      { kind: "door", x: -20, z: 16, yaw: Math.PI / 2 },
    ],
  },
  {
    id: "two-line-ship-store",
    name: "2라인 검사 적재 + 출고/보관",
    description: "두 라인에서 스캔 후 적재하고, AMR이 완료 팔레트를 랙에 보관하며 도크로 출고합니다.",
    equipment: [
      ...([-1, 1] as const).flatMap((side) => line({ x: side * innerZ, z: -4.5, yaw: 0 }, 4, cells(3, () => ({ side })))),
      ...([-1, 1] as const).flatMap((side) => {
        const aisle = side * (innerZ + AISLE_OFFSET);
        return [
          { kind: "dock", x: aisle, z: -9, yaw: 0 },
          { kind: "amr", x: aisle, z: -6.4, yaw: 0 },
          forklift(aisle + side * 7.4, -6.4),
          ...rackBlock(aisle, side, 1),
        ] as TemplateEquipment[];
      }),
      { kind: "floor", x: 0, z: 6, yaw: 0, floor: { width: 34, depth: 36, wallHeight: 6 } },
      { kind: "door", x: -17, z: 16, yaw: Math.PI / 2 },
      { kind: "door", x: 17, z: 16, yaw: -Math.PI / 2 },
    ],
  },
  {
    id: "four-line-high-throughput",
    name: "4라인 고처리량 + 공용 랙",
    description: "네 라인(라인당 로봇 3대)이 공용 랙 구역과 출고 도크를 함께 사용하는 고처리량 레이아웃입니다.",
    equipment: [
      ...[[-innerZ, -1], [-wallZ, 1], [wallZ, -1], [innerZ, 1]].flatMap(([z, side]) =>
        line({ x: SUITABLE_START, z, yaw: SUITABLE_YAW }, 5, [0, 1, 2].map((k) => ({ at: firstSlot + k * R.robotPitch, side: side as -1 | 1 })))),
      ...[-18.5, -23.2].flatMap((x) => [-6.5, 0, 6.5].map((z) => rack(x, z))),
      { kind: "dock", x: 13.77, z: -aisleZ, yaw: SUITABLE_YAW },
      { kind: "dock", x: 13.77, z: aisleZ, yaw: SUITABLE_YAW },
      { kind: "amr", x: 10.4, z: aisleZ, yaw: SUITABLE_YAW },
      { kind: "amr", x: 10.4, z: -aisleZ, yaw: SUITABLE_YAW },
      { kind: "amr", x: 7.6, z: aisleZ, yaw: SUITABLE_YAW },
      { kind: "amr", x: 7.6, z: -aisleZ, yaw: SUITABLE_YAW },
      { kind: "floor", x: -4, z: 0, yaw: 0, floor: { width: 44, depth: 24, wallHeight: 6 } },
      { kind: "door", x: -26, z: 4, yaw: Math.PI / 2 },
      { kind: "door", x: -26, z: -4, yaw: Math.PI / 2 },
      forklift(-15.4, 0),
    ],
  },
  {
    id: "inbound-scan-store",
    name: "입고 검사 · 적재 · 랙 보관 흐름",
    description: "입고 컨베이어의 박스를 스캔해 불량은 별도 팔레트로 분리하고, 정상품은 적재 후 지게차가 랙에 보관합니다.",
    equipment: [
      ...line({ x: 0, z: -4.5, yaw: 0 }, 5, cells(4, (k) => (k === 0 ? { pallet: { capacity: 3, grade: "defect" as const }, robot: { pickFilter: "defect" as const } } : { pallet: { capacity: 3 } })), { defectRate: 0.2 }),
      { kind: "dock", x: inspectionAisleX(0), z: -9, yaw: 0, settings: { acceptGrade: "defect" } },
      { kind: "amr", x: inspectionAisleX(0), z: -6.4, yaw: 0 },
      forklift(-AISLE_OFFSET - 7.4, -6.4),
      ...rackBlock(-AISLE_OFFSET, -1, 2, normal),
      { kind: "floor", x: -7, z: 6, yaw: 0, floor: { width: 26, depth: 36, wallHeight: 6 } },
      { kind: "door", x: -20, z: 16, yaw: Math.PI / 2 },
    ],
  },
];
