# Smart Factory

React와 Three.js 기반의 3D 공장 시뮬레이터입니다. 로봇·컨베이어·팔레트·AMR·스캐너를 자유롭게 배치하고, 박스 이송·적재·출고 과정을 실행합니다.

SIMULATION과 MONITORING 화면을 제공합니다. 현재 실제 설비 통신·제어 전송은 연결되어 있지 않으며, 미연동 telemetry는 모의 값으로 표시합니다.

## 시작하기

Node.js와 npm을 준비한 뒤 프로젝트 루트에서 실행합니다.

```sh
npm ci
npm run dev
```

개발 서버 주소는 터미널의 Vite 출력을 확인합니다.

```sh
npm run build       # TypeScript 검사 후 배포 번들 생성
npm run preview     # 생성된 dist 번들 미리보기
npm run lint        # ESLint 검사
```

`preview`는 빌드가 완료된 뒤 사용합니다.

## 주요 기술

- React · TypeScript · Vite
- Three.js · React Three Fiber · Drei
- Zustand
- Tailwind CSS · Radix UI · Lucide
- closed-chain-ik · three-mesh-bvh

## 사용 흐름

### SIMULATION

1. **Edit → Asset**에서 장비를 선택하거나 장면으로 드래그하여 배치합니다. 배치 전 고스트로 위치를 확인할 수 있습니다.
2. **Template** 카드를 누르면 준비된 배치로 교체합니다. 템플릿 정의는 [sceneTemplates.ts](src/constants/sceneTemplates.ts)에 있습니다. 배치 교체도 편집 이력에 포함됩니다.
3. 선택한 오브젝트의 속성 패널에서 위치·회전과 장비별 값을 수정합니다.
4. **Play**로 전환한 뒤 **시작**을 눌러 실행합니다. 전체 배속·초기화·장비 상태를 확인할 수 있습니다.
5. 장비 목록의 더블클릭 또는 Enter로 상세 화면을 열고 상태·설정·관절 값 등을 확인합니다.

Edit / Play, 패널 열림 여부, 시뮬레이션 실행 여부는 각각 별도 상태입니다. 패널을 닫거나 장비 상세로 이동하는 동작만으로 실행이 종료되지 않습니다. Edit로 돌아가면 실행 상태를 초기화합니다.

### MONITORING

Edit / Play 도구를 숨기고 공통 Equipments / Details / Dashboard 패널을 사용합니다. 장비 설정 적용은 읽기 전용입니다. 실제 설비 데이터 수신과 명령 전송·응답 처리는 별도 연동이 필요합니다.

### 편집과 카메라 조작

- `Ctrl+Z` / `Cmd+Z`: 실행 취소
- `Ctrl+Shift+Z` / `Cmd+Shift+Z`: 다시 실행
- `Delete` / `Backspace`: 편집 중 선택한 오브젝트 삭제
- 휠: 확대·축소
- 오른쪽 드래그: 팬

단축키는 편집 모드에서 동작하며, 텍스트 입력 중에는 삭제·실행 취소를 가로채지 않습니다.

바닥/벽 에셋은 선택 후 바닥을 드래그하여 영역을 정하고, 마우스를 이동해 벽 높이를 지정한 뒤 클릭하여 확정합니다. 좌하단에서 단계와 치수를 확인할 수 있으며, 벽 높이 조정 중 Esc를 누르면 바닥만 생성합니다. 그리기 중에도 휠과 팬을 사용할 수 있습니다.

장비 상세의 추적 버튼을 누르면 카메라가 대상을 따라가고 타깃 마크·바닥 링을 표시합니다. 추적 중 회전·줌을 조절할 수 있으며 팬 또는 해제 버튼으로 추적을 종료합니다.

## 폴더 구조

```text
src/
├── App.tsx                  # Viewport와 HUD 조립
├── components/              # 작은 공용 UI: Button·Select·Tabs·Badge 등
├── ui/                      # 공용 컴포넌트를 조합한 React 화면
│   ├── Header/              # 모드 선택·정보 탭
│   ├── Hud/                 # 에셋·설비 상세·설정·통계·재생 패널
│   └── tracking/            # 추적 상태·실시간 정보 표시
├── viewport/                # Three.js 장면 표현과 React 연결
│   ├── index.tsx            # Canvas·장면·카메라 조립
│   ├── SimulatorScene.tsx   # 편집·실행 장면 전환
│   ├── editor/              # 배치·변환 조작·고스트·컨베이어 확장 조작
│   ├── simulation/          # 실행 장면과 도메인 엔진을 연결하는 컴포넌트·훅
│   ├── camera/              # 카메라 이동·추적
│   ├── instancing/          # GPU 인스턴싱·등록 모델 동기화
│   ├── selection/           # 클릭 해석·선택 외곽선
│   ├── tracking/            # 타깃 마크·바닥 링·추적 범위 계산
│   ├── shadows/             # 그림자 조명
│   └── scene/               # 실행 중인 장면 오브젝트 조회
├── objects/                 # 설비별 3D 모델·시각 표현
│   ├── robot/               # 로봇 모델·미리보기·작업 반경
│   ├── amr/                 # AMR 모델·경로 표시
│   ├── conveyor/            # 벨트 모델·형상 생성
│   ├── pallet/              # 팔레트 모델
│   ├── scanner/             # 스캐너 모델·검사 시각화
│   ├── room/                # 바닥·벽·기둥·지붕·재질
│   ├── dock/                # 출고 구역 모델
│   └── box/                 # 박스 모델
├── domain/                  # 설비 동작 규칙과 계산
│   ├── robot/               # 제어 인터페이스·흡착 제어·IK·범위 계산
│   ├── amr/                 # 배차·교통 제어·경로 탐색
│   ├── pallet/              # 슬롯 예약·적재 상태·패킹 알고리즘
│   ├── conveyor/            # 연결·길이·경로 계산
│   ├── scanner/             # 검사 판정·집계
│   └── simulation/          # FactorySimulator·시간 계산·렌더링 계약
├── stores/                  # Zustand 공유 상태와 액션
│   └── actions/             # 템플릿 적용·설정 명령 등 여러 상태 연결
├── hooks/                   # 생명주기·구독·telemetry 등 React 연결 로직
├── lib/                     # 외부 기술 설정·래퍼·어댑터
│   ├── style.ts             # clsx + tailwind-merge를 묶는 cn()
│   └── three/               # 모델 정규화·복제·캐시
├── utils/                   # 포맷 등 작은 공용 함수
├── constants/               # 공통 설정과 상수
├── types/                   # 공유 타입
├── mock/                    # 개발용 데이터
├── legacy/                  # 기존 데모·검증용 엔진·전용 UI
└── assets/                  # GLB·이미지·텍스처
```

### 코드 배치 기준

- **components**: Radix 기반의 작은 재사용 UI를 둡니다. 장비나 시뮬레이션 규칙을 넣지 않습니다.
- **ui**: Header·Hud·장비 상세처럼 컴포넌트를 조합한 화면을 둡니다. 표시 문구·Props·스타일은 사용하는 화면 가까이에 둡니다.
- **viewport**: 카메라·조명·렌더링·선택·추적과 3D 편집 조작을 담당합니다. Ghost는 실제 설비가 아닌 배치 미리보기이므로 `viewport/editor`에 둡니다.
- **objects**: 장비의 3D 표현을 담당합니다. 예를 들어 `Robot.tsx`는 모델을 표시하고 `domain/robot/SuctionRobotController.ts`가 관절·집기 동작을 계산합니다.
- **domain**: IK·경로 탐색·적재·검사·시뮬레이션 규칙을 둡니다. React·UI·Zustand 스토어·구체적인 viewport 구현을 참조하지 않습니다. 기존 Three.js 기반 수학과 장면 상태는 유지합니다.
- **stores/actions**: UI에서 받은 명령을 상태 계층으로 전달합니다. 여러 스토어를 함께 변경하는 작업도 여기서 조정합니다.
- **hooks**: 도메인 결과와 React 생명주기·스토어 구독을 연결합니다. 프레임마다 바뀌는 좌표·관절 값은 컨트롤러와 ref에서 처리합니다.
- **lib**: 외부 기술을 프로젝트에서 쓰기 위한 래퍼를 둡니다. 현재 `cn()`과 Three.js 모델 정규화·복제 코드가 해당합니다. API·WebSocket 클라이언트도 향후 이 계층에 둘 수 있으며, 배차·적재 규칙은 `domain`에 둡니다.
- **utils**: 특정 장비 규칙이나 외부 기술 설정이 아닌 작은 공용 포맷·변환 함수를 둡니다.

## 주요 진입점과 실행 연결

[App.tsx](src/App.tsx)가 [Viewport](src/viewport/index.tsx)와 [Hud](src/ui/Hud/index.tsx)를 배치합니다. Header 아래 남은 flex 영역에 사이드바·패널을 조합하며 추적 오버레이는 헤더·사이드바를 제외한 영역을 사용합니다.

[SimulatorScene](src/viewport/SimulatorScene.tsx)은 편집·실행 장면을 전환합니다. [useFactoryRuntime](src/viewport/simulation/useFactoryRuntime.ts)이 모델·상태·렌더러를 [FactorySimulator](src/domain/simulation/FactorySimulator.ts)에 연결합니다. 엔진은 로봇 작업 배정, 컨베이어 박스 이송, 팔레트 적재와 AMR 출고를 조정합니다.

[InstancedScene](src/viewport/instancing/InstancedScene.tsx)은 등록된 메쉬를 동일한 형상·재질별로 묶어 그리기 호출을 줄입니다. 원본 모델 계층은 IK·충돌·추적 계산을 위해 유지하고, 클릭한 인스턴스는 실제 설비 ID로 연결합니다. 도메인 엔진은 구체적인 인스턴싱 클래스 대신 [SimulationRenderer](src/domain/simulation/SimulationRenderer.ts) 인터페이스를 받습니다.

### 장비별 책임

- **로봇**: [RobotController](src/domain/robot/RobotController.ts)가 공통 계약이며, [SuctionRobotController](src/domain/robot/SuctionRobotController.ts)가 흡착 집기 동작을 구현합니다. IK·관절·이동 계획 설정은 [simulation.ts](src/constants/simulation.ts)를 확인합니다.
- **팔레트**: [PalletController](src/domain/pallet/PalletController.ts)가 슬롯 예약·적재·출고 잠금·빈 팔레트 교체를 담당하고, `domain/pallet/packing`에서 적재 위치를 계산합니다.
- **AMR**: [PalletDispatchController](src/domain/amr/PalletDispatchController.ts)가 운반 상태를, [AMRTrafficController](src/domain/amr/AMRTrafficController.ts)가 차량 간 양보와 통행을 처리합니다. 경로 탐색은 `domain/amr/navigation`에 있습니다.
- **컨베이어**: 모델은 `objects/conveyor`, 연결·경로 계산은 `domain/conveyor`가 담당합니다. 연결된 구간은 속도를 공유하고, 확장 버튼과 배치 미리보기는 [ConveyorExtensionControls](src/viewport/editor/ConveyorExtensionControls.tsx)에 있습니다.
- **스캐너**: 모델의 `ScanPoint`를 통과하는 박스를 검사합니다. [ScannerInspection](src/domain/scanner/ScannerInspection.ts)이 판정·중복 방지·집계를 담당합니다. 표시와 집계 용도이며 불량 박스를 자동 배출하지 않습니다.
- **Dock**: AMR이 적재 팔레트를 운반하는 출고 목적지의 바닥 표시입니다. 충전소 모델이 아닙니다.
- **바닥/벽**: [FloorRoom](src/objects/room/FloorRoom.tsx)이 벽 패널·기둥·천장 트러스를 조합합니다. 구조 설정은 [factoryRoom.ts](src/constants/factoryRoom.ts)에 있습니다. 별도로 그린 공간 간 벽 병합과 구조물 충돌 계산은 지원하지 않습니다.

## 상태와 설비 데이터

[useSceneStore](src/stores/useSceneStore.ts)는 배치·선택·장비 설정·편집 이력을, [useSimulationStore](src/stores/useSimulationStore.ts)는 실행·배속·통계·장비 상태를 관리합니다. 패널과 탭 표시 상태는 [useHudStore](src/stores/useHudStore.ts)가 담당합니다.

장비 정보·설정·실시간 지표는 `ui/Hud/equipment`의 장비별 상세 컴포넌트가 구성합니다. 공통 레이아웃과 입력 UI는 재사용하며, 값 적용은 [applyEquipmentSettings](src/stores/actions/applyEquipmentSettings.ts)를 통합니다.

`SceneEquipment.metadata`는 제조사·모델·일련번호·설치 위치·IP 등을 선택적으로 담고, `EquipmentSnapshot.telemetry`는 연결·온도·전력·사이클 등의 값을 선택적으로 담습니다. 실제 telemetry가 있으면 우선 사용하며, 미연동 지표는 모의 표시를 붙입니다. 누락된 기본 정보는 임의로 생성하지 않습니다.

기본 `sceneMode`는 `simulator`입니다. 기존 `robot`·`conveyor`·`amr` 데모는 `legacy`에 보존하고 선택 시 지연 로드합니다.

## 검증

```sh
npm run test:architecture    # 내부 import 경로·domain 의존 경계
npm run test:editor-history  # 배치·설정·삭제·확장 실행 취소/다시 실행
npm run test:scene-state     # 편집·실행 상태 분리와 바닥 크기 변경
npm run test:templates       # 배치 교체·검증·실행 연결
npm run test:instances       # 인스턴싱·부착·좌표 동기화·정리
npm run test:flow-speed      # 연속 이송·연결 구간 속도·전체 배속
npm run test:scanner         # 검사 판정·집계·표시 복원
npm run test:amr             # 경로 탐색·교통·운반
npm run test:fleet           # 다중 AMR·팔레트·출고 큐
npm run test:ik              # 실제 GLB 기반 로봇 제어·IK·집기·적재
```

추가 레이아웃·패킹 검증 명령은 [package.json](package.json)의 `scripts`를 확인합니다. 검증 스크립트는 프로젝트 루트에서 실행하며, 일부는 실제 GLB를 읽어 `.tmp` 아래에 임시 모듈을 생성하므로 순서대로 실행합니다.

설정과 코드 작성 규칙은 [AGENTS.md](AGENTS.md)를 따릅니다.
