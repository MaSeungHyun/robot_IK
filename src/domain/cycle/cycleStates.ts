/**
 * Explicit state machines of the pallet cycle (Korean labels for details / logs).
 * Domain values stay English; the labels are display text.
 */
export const SHUTTLE_STATES = {
  loading: "팔레트 적재 중 (로봇 적재 대기)",
  toUnload: "만재 · 스캐너 하역 위치로 이동",
  unloading: "스캐너 로봇 하역 중",
  toService: "만재 · 지게차 교체 위치로 이동",
  waitSwap: "지게차 팔레트 교체 대기",
  swapping: "지게차가 팔레트 교체 중",
  waitEmpty: "만재 팔레트 내림 · 빈 팔레트 공급 대기",
  returning: "빈 팔레트로 적재 위치 복귀",
  docking: "적재 위치 정렬",
  waitDock: "하역 위치 비기를 대기",
  toReceive: "빈 AMR · 입하 컨베이어 받는 위치로 이동",
  waitPallet: "입하 컨베이어 팔레트 대기 (롤러 상단)",
  rollOn: "입하 팔레트가 롤러로 AMR에 이송 중",
  waitEmptyPick: "빈 팔레트 지게차 회수 대기",
  emptyPicking: "지게차가 빈 팔레트 회수 중",
} as const;
export type ShuttleState = keyof typeof SHUTTLE_STATES;

export const FORKLIFT_TASK_STATES = {
  idle: "작업 대기",
  toPick: "팔레트로 이동",
  pickUp: "포크 삽입 · 팔레트 들어올림",
  carry: "팔레트 운반",
  waitTarget: "놓을 위치 대기",
  putDown: "팔레트 내려놓기 · 포크 빼기",
  toSource: "빈 팔레트 적치장으로 이동",
  returning: "대기 위치 복귀",
  holdLoading: "팔레트를 든 채 로봇 적재 대기",
  toDock: "만재 팔레트를 하역 로봇으로 운반",
  holdUnloading: "팔레트를 든 채 로봇 하역 대기",
  toStation: "빈 팔레트로 적재 위치 복귀",
} as const;
export type ForkliftTaskState = keyof typeof FORKLIFT_TASK_STATES;

/** What a cycle forklift is doing (service: AMR swap; rack: Rack_m → Rack / Rack → 출하). */
export const FORKLIFT_JOBS = {
  swapFull: "만재 팔레트 AMR → Rack_m",
  storeDirect: "만재 팔레트 AMR → 랙 (Rack_m 없음)",
  swapEmpty: "빈 팔레트 적치장 → AMR",
  store: "Rack_m → 랙 적재",
  ship: "랙 → 출하 로봇 옆 (사용 안 함)",
  takeEmpty: "빈 팔레트 AMR → 빈 팔레트 적치장",
  carry: "하역: 만재 팔레트 → 랙 적재 · 빈 팔레트 복귀",
} as const;
export type ForkliftJobKind = keyof typeof FORKLIFT_JOBS;

export const RACK_M_STATES = {
  filling: "적재 중",
  waitAgv: "만재 · AGV 호출",
  transit: "AGV 운반 중",
  unloading: "랙 지게차 하역 중",
  returning: "빈 상태로 복귀 중",
} as const;
export type RackMState = keyof typeof RACK_M_STATES;

export const AGV_STATES = {
  idle: "대기",
  toRack: "Rack_m 하부로 이동",
  lifting: "Rack_m 들어올림",
  toDrop: "랙 구역으로 운반",
  lowering: "Rack_m 내려놓기",
  waitEmpty: "하역 완료 대기",
  toBay: "빈 Rack_m 복귀 운반",
  returning: "대기 위치 복귀",
} as const;
export type AgvState = keyof typeof AGV_STATES;
