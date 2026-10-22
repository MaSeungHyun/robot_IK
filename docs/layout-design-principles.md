# 공장 레이아웃 설계 원칙 (자동 배치 1단계)

자동 배치 생성기(`src/domain/layout/autoLayout.ts`)가 따르는 설계 원칙과, 각 원칙을 코드에서 어떻게 쓰는지 정리한다.
규칙 정의는 `src/domain/layout/designRules.ts`의 `DESIGN_RULES`에 있다.

- **constraint**: 위반하면 후보를 버린다.
- **score**: 점수가 나빠진다(낮을수록 좋음).
- **generator**: 후보를 만드는 방식 자체에 반영된다.

## 1. 원칙과 출처

### 1.1 Systematic Layout Planning (SLP, Richard Muther)

- **관계표(A/E/I/O/U/X):** 활동 영역 쌍마다 근접 필요도를 매긴다.
  - A = 절대 필요, E = 특히 중요, I = 중요, O = 보통, U = 무관, X = 떨어져야 함.
  - 관계도를 그린 뒤 면적을 반영한 공간 관계도와 블록 배치로 옮긴다.
- **대안 비교:** 2~3개의 뚜렷이 다른 대안을 만든다(직선 흐름 vs U자 흐름 + 입출고 통합 등). 비용·효익을 공식적으로 점수화해 비교한다.
- **주 통로:** 남는 공간이 아니라 명시적인 면적 할당으로 계획한다(Good Practice #10).
- **물류 흐름:** 짧고 직접적으로 하고, 역행과 교차를 최소화한다.
- **출처:**
  - [Muther, *Procedure for Making Relationship Diagrams*](https://richardmuther.com/wp-content/uploads/2014/06/1111.pdf)
  - [Muther, *Good Practice in Plant Layout and Facilities Planning*](https://richardmuther.com/wp-content/uploads/2014/06/1108.pdf)
  - [Georgia Tech, SLP 요약](https://www2.isye.gatech.edu/~mgoetsch/cali/Spiral/Spiral%20HTML%20Help/SystematicLayoutPlanningorSLP.htm)
  - [Concordia INDU421, Flow patterns (I/U/S/W/O, spine/loop)](https://users.encs.concordia.ca/~andrea/indu421/Presentation%206%20(Flow%20II).pdf)

### 1.2 AMR/AGV 운행 구역: ISO 3691-4:2020 Annex A

- **운행 구역(operating zone):** 경로 양옆에 0.5 m 폭, 2.1 m 높이의 여유를 고정 구조물과의 사이에 둔다.
- **여유가 부족한 경우:** 운행 위험 구역(감속, 경고, 인체 감지)이나 제한 구역(펜스, 출입 통제)으로 지정해야 한다.
- **하역 구역(load transfer area):** 운행 위험 구역의 예다. 로봇 팔레트를 AMR이 가져가는 지점이 여기에 해당한다.
- **폭 측정:** 실제 적재 상태의 차체 외곽으로 잰다.
- **출처:**
  - [GT Engineering, ISO 3691-4 해설](https://www.gt-engineering.it/en/insights/machinery-safety/norma-iso-3691-4-2020-gt-engineering/)
  - [3Laws, ISO 3691-4 zones](https://3laws.io/iso-3691-4-what-it-means-for-your-products/)
  - [RobotAtom, AMR operating zone](https://robotatom.com/blog/amr-operating-zone-needs-change-control)

### 1.3 로봇 팔레타이징 셀: ISO 10218-2, ISO 13857, 업계 가이드

- **동선부터 그린다:** 박스 경로(투입 → 집기 → 적재 → 팔레트 반출)를 먼저 그리고, 로봇 도달 범위는 그중 한 요소로 본다.
- **가깝게 배치한다:** 집기 위치와 팔레트를 로봇 가까이 두되 충돌 여유는 확보한다.
- **투입 버퍼:** 투입 컨베이어에 목표 처리량 기준 30~60초 분량의 적치(accumulation)를 둔다.
  - 버퍼는 일시 정지를 흡수할 뿐, 느린 셀을 빠르게 만들지는 못한다.
- **팔레트 교체:** 교체 때문에 라인이 서지 않도록 팔레트 위치 2개나 팔레트 버퍼를 둔다.
- **방호:**
  - 로봇 작업 영역 전체(툴, 화물, 팔레트 밖으로 넘어가는 궤적 포함)를 펜스, 라이트 커튼, 에어리어 스캐너로 방호한다.
  - 거리는 ISO 13855/13857 기준이다.
  - 팔레트 반출구는 뮤팅한다.
- **출처:**
  - [KRONA ROBOT, Palletizing cell design](https://www.kronarobot.com/insights/robotic-palletizing-cell-design/)
  - [BW Packaging, Floor space for palletizing](https://www.bwpackaging.com/blog/floor-space-requirements-for-palletizing-systems--a-layout-planning-guide)
  - [Robotiq, Palletizer safety guidelines](https://www.cisco-eagle.com/uploads/Robotiq/Robotiq-Palletizing-Solution-Safety-Guidelines.pdf)

### 1.4 완제품 팔레트 보관 (랙)
- 보관 용량 = 처리량 × 체류 시간. 랙은 꽉 찬 팔레트를 보관해 바닥을 정리하고, 이후 출고(랙 → AMR → 도크/문)를 원활하게 한다.
- 흐름: 팔레트 → AMR → 랙(보관) → AMR → 도크/문(출고). 랙은 팔레트-AMR 동선과 도크/문 사이에 둔다.
- 출처: E. Frazelle, *World-Class Warehousing and Material Handling* (보관 용량 산정), Tompkins et al., *Facilities Planning* (흐름 거리 × 물량 최소화).

## 2. 코드 반영표

| ID | 종류 | 원칙 | 구현 |
|---|---|---|---|
| R-AISLE | constraint | AMR 운행 구역 | 통로 폭 = 적재 AMR 지름 1.64 + 2×0.5 = **2.64 m**. 통로 사각형에 설비가 들어오면 기각 |
| R-MAIN-AISLE | constraint | 통로 명시 할당 | 통로 사각형을 사용 면적과 바닥 적합성 검사에 포함 |
| R-WALL | constraint | 고정 구조물 여유 | 모든 설비 및 통로와 벽 사이 0.5 m |
| R-DOOR | constraint | 문 앞 확보 | 문 폭+1 m × 3 m를 비워 둠. 도크 열은 문 쪽 |
| R-REACH | constraint | 집기/적재 도달 | 벨트 중심과 팔레트 먼 모서리가 reach 이내 |
| R-OVERLAP | constraint | 겹침 없음 | SAT 겹침 검사. 일반 0.15 m, 로봇↔자기 벨트/팔레트 0.05 m(기존 템플릿 간격) |
| R-GUARD | constraint | 로봇 방호 | 로봇 reach 사각형과 문 앞 구역의 겹침 금지. 통로는 자기 팔레트(하역 구역, 반출 뮤팅 가정)에서만 접함 |
| R-PATTERN | generator | 흐름 패턴 대안 | 직선(1줄, 통로 공유 2줄), L, U를 모두 생성해 비교 |
| R-FLOW | generator | 단방향 흐름 | 투입 → 로봇 → 팔레트 → AMR → 문 옆 도크. 레이아웃을 회전해 도크 끝을 문 벽에 붙임 |
| R-BUFFER | generator | 병목 앞 버퍼 | 첫 로봇 앞 빈 투입 구간 = ceil(벨트 속도 × 45 s / 2.5 m / 2), 1~3개 |
| R-CROSS | score | 교차 최소화 | 팔레트→가장 가까운 도크 직선 경로가 벨트와 교차할 때마다 +5 |
| R-SLP | score | 관계 근접 | `RELATIONSHIPS` 표(A: 벨트-로봇, 로봇-팔레트 / E: 팔레트-AMR, 도크-문 / I: 팔레트-도크·랙 / X: 로봇-문, 로봇-AMR). 가장 가까운 상대까지 거리 × 가중치, X는 3 m 이내일 때 벌점. ×0.5 |
| R-PALLET-CHANGE | score | 팔레트 교체 무정지 | 시뮬레이션에서 가득 찬 팔레트가 AMR을 기다린 시간 비율 × 20 |
| R-RATE | score | 최소 설비로 목표 달성 | 목표 미달 비율 × 1000 + 설비 비용(로봇 10, AMR 6, 랙 4, 도크 2, 벨트 0.5) + 사용 면적 × 0.02 + 미처리 박스/h × 0.05 |
| R-STORAGE | constraint | 완제품 팔레트 보관 용량 | `storageRequirement()`: 필요 팔레트 = ceil(목표 × 보관 시간(기본 2h) / 팔레트당 박스 40), 랙 = ceil(팔레트 / 8슬롯). 랙은 필수(검색에서 줄이지 않음), `maxRacks`로 부족하면 부족분 × 200점 |
| R-TRAVEL | score | 운반 거리 최소화 | 팔레트당 평균 보관(팔레트→랙) + 출고(랙→도크) 직선 거리 × 0.3 |
| R-SLP (랙) | score | 보관 관계 | pallet-rack E, rack-door E, rack-dock E, rack-amr I |
| (출고 훅) | — | 랙 → 도크 출고 | `LayoutCandidate.outbound` (랙→도크 쌍). 출고 시뮬레이션은 다음 단계 |

## 3. 반영하지 않았거나 단순화한 것

- **방호 펜스와 인체 통로:** 별도 지오메트리가 없다.
  - 로봇 reach와 통로의 겹침은 자기 팔레트에서만 허용하는 것으로 가정했다(하역 구역 + 반출 뮤팅).
- **확장 여유(SLP 대안 평가 항목):** 점수에 없다.
- **팔레트 2위치 스테이션:** 템플릿 형식상 로봇당 팔레트 1개다. 대신 AMR 대기 비율로 간접 평가한다.
- **실제 경로 길이:** R-CROSS와 R-SLP는 직선 거리 근사다. 실제 AMR 경로와 대기는 시뮬레이션 지표가 반영한다.
