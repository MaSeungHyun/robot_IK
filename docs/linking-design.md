# 오브젝트 링킹(🔗) 설계

> 상태: 1차 구현 완료 (미커밋). 기준 커밋 `423bf46`. 확정 결정은 §0, 실제 구현과 다른 부분은 §0이 우선.

## 0. 확정 결정 (2026-10-22)

1. **AMR 그룹 없음:** AMR마다 `pickup` 링크(AMR → 팔레트)를 단다.
2. **전용 링크 모드:** 편집 모드 왼쪽 세로 도구 막대(선택 W / 이동 G / 회전 R / 연결 L)의 🔗 버튼 또는 `L` 키.
3. **폴백:** 링크가 없는 설비(해당 타입 기준)는 기존 거리 기반 동작을 그대로 유지한다. 링크가 있으면 링크가 우선.
4. **목적지 여러 개:** `deliver` 링크 중 acceptGrade·enabled·빈 곳을 통과한 **가장 가까운** 곳.
5. **컨베이어끼리:** 링크 없이 기존 끝점 자동 연결 유지. `feed` 링크는 연결된 컨베이어 구간 전체에 적용된다.
6. **배터리:** 고정 `chargeBelow` 유지 (충전 중인 AMR은 배정 제외).
7. **`priority`·`inspect` 링크·추정 관계 자동 변환 버튼:** 이번 범위에서 제외 (보류).
8. **표시:** 링크 경로와 마커는 편집 모드에서만 그린다(`SceneEditor` 안에 마운트). 재생 중에는 항상 숨김. 마커는 링크 모드에서만.

### 구현 요약

- 데이터: `src/types/links.ts`(`SceneLink`, `LINK_RULES`, `resolveLink`, `LinkIndex`), `useSceneStore.links`/`addLink`/`removeLink` (undo 포함, 설비 삭제 시 관련 링크 제거).
- 직렬화: `SceneTemplate.links?: {type, from, to}[]`(장비 인덱스). export 스니펫이 `links`를 출력. 링크 없는 템플릿은 그대로 동작.
- 시뮬레이터: 로봇 팔레트 후보(`load`), 박스 후보 컨베이어(`feed`), far-first 기준 로봇, `ship()`의 로봇·컨베이어·목적지(`deliver`), AMR 후보(`pickup`).
- 운반 큐: `src/domain/amr/TransportQueue.ts` (queued → assigned → done). 배정은 가장 가까운 유휴 AMR, 동률이면 완료 건수가 적은 쪽.
- 편집 UX: `src/ui/Hud/editor/EditorToolbar.tsx`, `src/viewport/editor/links/*` (마커, 점선 경로 + 방향 화살표, 클릭 선택, Delete로 해제), 디테일 패널 "연결" 섹션.
- 레이캐스트: 링크 모드에서는 바닥/벽(`FloorRoom`)이 레이를 받지 않고, 링크 불가 설비는 클릭을 통과시킨다. 지붕·프레임은 원래부터 제외.

## 1. 목표

- **토폴로지 명시:** "누가 누구와 일하는지"를 거리나 등급 추정이 아니라 사용자가 정한 링크로 결정한다.
- **실제 공장 흐름 재현:** 팔레트 적재 완료 이벤트 → 운반 작업 큐 → FMS 배정(유휴/근접/배터리) → 고정 픽업 위치 → 지정 목적지.
- **선택 대상 축소:** 레이캐스트와 선택은 상호작용 대상(링크 가능한 설비)만 검사한다.
- **설비 ID 바인딩 준비:** 이후 OPC UA → WebSocket 상태(설비 ID 키)를 같은 오브젝트에 연결한다.

## 2. 현재 구조 (암묵적 관계)

| 관계 | 현재 결정 방식 | 위치 |
|---|---|---|
| 컨베이어 → 컨베이어 | 끝점 근접으로 자동 연결 (`beltConnections`) | `FactorySimulator` 생성자 |
| 로봇 → 팔레트 | 로봇별 거리순 `palletOrder` + `reach` 안의 슬롯 | `FactorySimulator` (≈L193, L370~) |
| 로봇 ← 컨베이어(박스) | 모든 박스 중 `reach` 안 + `pickFilter` + 팔레트 `grade` 매칭 | 같은 곳 |
| 팔레트 적재 순서 | 가장 가까운 로봇 기준 far-first | ≈L201 |
| 팔레트 → 목적지 | `acceptGrade`(any/normal/defect) 통과한 dock/rack 중 **가장 가까운 곳** | `ship()` ≈L625 |
| AMR 배정 | 유휴·충전 아님 중 완료 수 적은 순 + 랜덤 (거리/배터리 미반영) | `advanceDispatch` ≈L527 |
| `ship()`의 robot/belt | 팔레트에서 가장 가까운 로봇·컨베이어 (경로 계산용 layout) | ≈L626 |

문제: 배치가 바뀌면 관계가 의도와 다르게 바뀌고, 두 라인이 가까우면 서로의 팔레트·도크를 가져다 쓴다. 사용자는 관계를 볼 수도 고칠 수도 없다.

## 3. 데이터 모델

### 3.1 링크 타입

```ts
// src/types/links.ts
export type LinkType =
  | "feed"     // conveyor -> robot   : 이 컨베이어의 박스를 이 로봇이 집는다
  | "load"     // robot -> pallet     : 이 로봇이 이 팔레트 스테이션에 적재한다
  | "pickup"   // amr -> pallet       : 이 AMR(그룹)이 이 스테이션의 팔레트를 운반한다
  | "deliver"  // pallet -> dock|rack : 이 스테이션의 팔레트는 이 목적지로 간다
  | "inspect"; // scanner -> conveyor : 이 스캐너가 검사하는 구간 (선택, 2단계)

export type SceneLink = {
  id: string;          // "L-001"
  type: LinkType;
  from: string;        // SceneEquipment.id
  to: string;
  priority?: number;   // 같은 from에서 여러 to 중 우선순위 (낮을수록 먼저)
};
```

- **방향은 물류 흐름 방향.** AMR만 예외로 `amr -> pallet`(담당 관계)이며, 목적지는 `pallet -> dock/rack`에서 가져온다. 이렇게 하면 "스테이션 1은 도크 A로" 규칙이 AMR과 독립이 된다.
- **AMR 그룹:** 1단계에서는 그룹 엔티티를 만들지 않고 AMR마다 `pickup` 링크를 단다. UI에서 여러 AMR을 다중 선택해 한 번에 링크하면 그룹처럼 보인다. 그룹 엔티티(`fleetId`)는 미결 질문(§10).
- **허용 쌍 표 (검증용):** `LINK_RULES: Record<LinkType, {from: EquipmentKind[]; to: EquipmentKind[]; maxTo?: number}>`
  - feed: conveyor → robot
  - load: robot → pallet
  - pickup: amr → pallet
  - deliver: pallet → dock | rack
  - inspect: scanner → conveyor (maxTo 1)

### 3.2 저장 위치

- `useSceneStore`에 `links: SceneLink[]` 추가 (objects/settings와 같은 레벨). 오브젝트 안에 `links` 배열을 넣지 않는 이유: 양방향 조회, 삭제 시 정리, undo/redo, 내보내기가 단일 배열 쪽이 단순하다.
- 액션: `addLink`, `removeLink`, `removeLinksOf(objectId)` (오브젝트 삭제 시 자동 호출), `setLinkPriority`.
- 조회 헬퍼 `src/domain/links/linkIndex.ts`: `outgoing(id, type)`, `incoming(id, type)` — 시뮬레이터 생성 시 한 번 Map으로 만든다.
- 기존 undo 스냅샷/복제(duplicate)에 links 포함. 복제 시 복제본끼리의 링크만 따라 복제한다(선택 그룹 내부 링크).

### 3.3 직렬화 (템플릿 / export)

- `SceneTemplate`에 `links?: { type; from: number; to: number; priority? }[]` 추가. 템플릿 장비에는 id가 없으므로 **equipment 배열 인덱스**로 참조한다. `loadTemplate`이 인덱스 → 새 id로 변환.
- `scripts/export-scene-template.devtools.js`: `objects` 인덱스 맵으로 links를 변환해 출력. 존재하지 않는 끝점의 링크는 `lost`에 기록.
- 저장된 씬(있다면 localStorage 등)도 `links` 필드 추가, 없으면 `[]`.

### 3.4 하위 호환

- **링크가 하나도 없는 씬 = 기존 동작(레거시 모드).** 거리/등급 매칭을 그대로 쓴다.
- 타입별 폴백: 어떤 로봇에 `load` 링크가 없으면 그 로봇만 기존 거리 기반 규칙을 쓴다. 즉 "링크가 있으면 링크가 우선, 없으면 기존 추정". 기존 템플릿이 깨지지 않는다.
- 에디터에 "현재 추정 관계를 링크로 변환" 버튼(§6.4)을 두어 한 번에 마이그레이션.
- `grade`/`acceptGrade` 설정은 유지한다. 링크는 "어디로 갈 수 있나", 등급은 "무엇을 받나"라는 서로 다른 축이라 둘 다 필터로 적용(교집합).

## 4. 시뮬레이터가 링크를 쓰는 방법

| 현재 | 변경 (링크 있을 때) |
|---|---|
| `palletOrder` = 모든 팔레트 거리순 | `outgoing(robot, "load")`의 팔레트만, `priority` → 거리순 |
| 박스 후보 = 모든 박스 | `incoming(robot, "feed")` 컨베이어 위 박스만 (+ `reach`, `pickFilter`, 등급 매칭 유지) |
| 팔레트 적재 순서 기준 로봇 = 최근접 | `incoming(pallet, "load")` 로봇 (여러 개면 첫 번째) |
| `ship()` 목적지 = acceptGrade 통과 + 최근접 | `outgoing(pallet, "deliver")` ∩ acceptGrade ∩ enabled ∩ 비어있음 → priority → 거리 |
| `ship()`의 robot/belt = 최근접 | `incoming(pallet,"load")` 로봇과 그 로봇의 `feed` 컨베이어 (경로 장애물 계산용) |
| AMR 후보 = 모든 유휴 AMR | `incoming(pallet, "pickup")` AMR만 (링크 없으면 전체) |

- `reach`는 링크가 있어도 물리 제약으로 남긴다. 링크했는데 닿지 않으면 검증 경고(§6.3)로 알린다.
- 링크 인덱스는 시뮬레이터 생성 시 계산 → 프레임마다 비용 없음. 오히려 후보 집합이 줄어 매 틱 루프가 가벼워진다.

## 5. 운반 작업 큐 + AMR 배정

### 5.1 구조

```ts
// src/domain/amr/TransportQueue.ts
type TransportTask = {
  id: string;            // "T-0001"
  palletId: string;      // CargoRegistry P-xxx
  stationId: string;     // 픽업 위치 (고정)
  destinations: string[];// deliver 링크 후보 (순서 = 우선순위)
  createdAt: number;
  state: "queued" | "assigned" | "picking" | "delivering" | "done" | "blocked";
  agentId?: string;
  blockedReason?: string;
};
```

- **생성:** 팔레트 `full` 전환 시 `palletFull` 이벤트 → 작업 enqueue (현재 `readyAt` 정렬 로직을 이 큐로 대체). CargoRegistry에도 이벤트 기록.
- **배정 (1초 주기 유지):** FIFO로 작업을 꺼내 후보 AMR을 점수화.
  - 후보 = `pickup` 링크된 AMR(없으면 전체) ∩ enabled ∩ idle ∩ !charging ∩ 배터리 ≥ 임계값(작업 예상 소모량 + 여유).
  - 점수 = 스테이션까지 경로 길이(또는 직선거리 근사) + 가중치 × 완료 수(부하 분산). 동점만 랜덤.
  - 목적지 예약은 배정 시점에 확정 (현재처럼 dock 1건, rack 슬롯 1개 booking).
- **막힘:** 목적지 전부 만석 → `blocked` + 사유(기존 waitingReason 문구 재사용), 다음 주기 재시도. 링크된 AMR이 없으면 "이 스테이션을 담당하는 AMR이 없습니다".
- 큐 상태는 HUD 이벤트/라인 패널에서 그대로 보여줄 수 있다(대기 작업 수, 평균 대기시간).
- 라이브 모드에서는 FMS가 배정을 내려주므로, 큐는 이벤트(`taskCreated/assigned/done`)를 받아 같은 구조를 채우기만 한다 — CargoRegistry와 같은 "이벤트로 구동 가능한" 형태로 만든다.

## 6. 에디터 UX

### 6.1 생성/삭제

- **링크 모드 토글:** 편집 모드 툴바에 🔗 버튼 (단축키 `L`). 일반 선택 모드와 분리해 오클릭을 막는다.
- 링크 모드에서: 시작 오브젝트 클릭 → 마우스를 따라가는 점선 → 대상 클릭으로 생성. 타입은 kind 쌍으로 자동 결정(§3.1 표). 허용되지 않는 대상은 호버 시 회색/금지 커서.
- 다중 선택(Shift) 후 대상 클릭 → 선택된 모든 오브젝트에서 링크 (AMR 여러 대 → 스테이션).
- **삭제:** 링크 선 클릭 후 Delete, 또는 우측 디테일 패널의 "연결" 섹션 행의 × 버튼.
- **디테일 패널 "연결" 섹션:** 선택한 오브젝트의 들어오는/나가는 링크를 이름·값 행으로 나열 (B안 스타일). 우선순위 ↑↓ 조절.

### 6.2 시각화

- 편집 모드 + (링크 모드 또는 오브젝트 선택 시)만 표시. 재생 중에는 기본 숨김, 토글 가능.
- 바닥 높이 약간 위 곡선/직선 + 흐름 방향 화살표(또는 대시 애니메이션). 색은 `brand-primary` 한 색, 선택된 오브젝트 관련 링크만 불투명, 나머지는 반투명.
- 구현: 링크 전체를 `LineSegments` 하나(또는 `Line2` 하나)에 모아 1 draw call. 오브젝트 이동 시 해당 링크 정점만 갱신.

### 6.3 검증 (경고 목록, 재생 전 표시)

- kind 쌍이 규칙에 맞지 않음 / 끝점 삭제됨 (자동 제거로 예방).
- 로봇 `load` 팔레트 슬롯이 `reach` 밖, `feed` 컨베이어가 `reach` 안을 지나지 않음.
- 팔레트에 `load`는 있는데 `deliver`/`pickup` 없음 → "적재 후 운반 불가".
- `deliver` 목적지의 `acceptGrade`가 팔레트 `grade`와 모두 불일치.
- 기존 `layoutNavigation`의 경로 검사를 링크 쌍(AMR→스테이션, 스테이션→목적지)에 적용.

### 6.4 자동 링크

- "추정 관계로 링크 생성" 버튼: 현재 거리/등급 규칙(§2)의 결과를 링크로 만들어 준다. 기존 템플릿 마이그레이션과 빠른 시작용.

## 7. 선택/레이캐스트 필터링

- 상호작용 대상 = 링크 가능한 kind(conveyor, robot, pallet, amr, dock, rack, scanner) + 박스(`userData.cargo`). 바닥/벽/지붕 등은 제외.
- three.js `Layers`: 상호작용 메시에 `INTERACT_LAYER`(예: 1)를 켜고 `raycaster.layers.set(INTERACT_LAYER)`. 렌더링에는 영향 없음.
- 대안/보완: R3F 이벤트에서 배경 오브젝트에 `raycast={() => null}` (Room*, Floor 계열). `InstancedScene`은 인스턴스 단위라 레이어 지정이 쉽다.
- 링크 모드에서는 추가로 "현재 시작점과 링크 가능한 kind"만 히트되게 필터 → 오선택이 없다.
- 효과: 호버 레이캐스트 비용 감소(특히 벽·바닥·박스 수백 개), 선택 오류 감소. FPS 자체 향상은 작다.

## 8. 설비 ID 바인딩 (후속)

- `SceneEquipment.metadata`에 `equipmentId`(PLC/OPC UA 노드 기준 ID) 추가. 링크와 같은 디테일 패널 "연결" 섹션에 "데이터 소스" 행으로 표시.
- 라이브 모드 스토어(`useLivePoseStore` 계열)가 `equipmentId → sceneId` 맵으로 상태를 적용. 링크(토폴로지)는 라이브에서도 이벤트 해석(어느 스테이션 팔레트인지 등)에 사용.

## 9. 구현 순서와 영향 파일

1. **데이터 모델** — `src/types/links.ts`(신규), `src/constants/linkRules.ts`(신규), `src/stores/useSceneStore.ts`(links, 액션, 삭제 연동, undo), `src/types/sceneTemplate.ts`, `loadTemplate`.
2. **직렬화** — `scripts/export-scene-template.devtools.js`, `src/constants/sceneTemplates.ts`(기본 템플릿에 링크 추가는 선택).
3. **시뮬레이터 소비 (폴백 포함)** — `src/domain/links/linkIndex.ts`(신규), `src/domain/simulation/FactorySimulator.ts`(palletOrder, 박스 후보, far-first 기준 로봇, `ship()` 목적지/robot/belt, AMR 후보).
4. **운반 작업 큐** — `src/domain/amr/TransportQueue.ts`(신규), `FactorySimulator.advanceDispatch` 교체, `CargoRegistry`(task 이벤트), HUD 라인 패널 지표.
5. **에디터 UX** — `src/stores/useModeStore.ts`(link 모드), `src/viewport/editor/LinkTool.tsx`·`LinkLines.tsx`(신규), 우측 디테일 패널 "연결" 섹션, 검증 경고 패널, 자동 링크 버튼.
6. **레이캐스트 필터** — `src/viewport/scene/sceneOwner.ts` 주변 레이어 상수, `objects/room/*`(raycast 비활성), `viewport/instancing/InstancedScene.tsx`.
7. **설비 ID 바인딩** — metadata 확장, 라이브 스토어 매핑 (라이브 모드 착수 시).

1~3만으로 "링크가 있으면 링크대로 동작"이 완성되고, 4는 AMR 배정 품질 개선, 5는 사용자가 링크를 만들 수 있게 한다. 사용성 확인을 빨리 하려면 1 → 5(최소: 생성/삭제/선) → 3 → 4 순도 가능.

## 10. 미결 질문

1. AMR 그룹을 엔티티(`fleet`)로 둘지, AMR별 링크로 충분할지.
2. 링크 모드 진입 방식: 별도 모드 vs 디테일 패널에서 "연결 추가" 후 대상 클릭.
3. 링크가 있는 씬에서도 일부 타입 미지정 시 거리 폴백을 허용할지, 아니면 경고 후 해당 설비 정지로 엄격하게 할지.
4. `deliver` 여러 개일 때 기본 선택: priority 우선 vs 가까운 곳 우선 vs 라운드로빈.
5. 컨베이어 → 컨베이어 연결도 링크로 옮길지(현재 끝점 자동 연결 유지 제안).
6. 배터리 임계값을 작업 예상 소모량으로 계산할지, 고정값(현재 `chargeBelow`)으로 둘지.