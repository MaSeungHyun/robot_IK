# React + TypeScript + Vite

## 현재 프로젝트 폴더 구조

자유 배치로 공장을 구성하고 장비를 실행하는 3D 공장 시뮬레이터입니다. 기존 로봇·컨베이어·AMR 데모는 기능 검증용 레거시로 분리했습니다.

```text
src/
├── features/
│   ├── simulator/                  # 실제 공장 시뮬레이터
│   │   ├── SimulatorScene.tsx      # 편집·실행 전환만 담당
│   │   ├── editor/                 # 편집 장면·장비·배치 입력·미리보기
│   │   └── runtime/                # 실행 장면·엔진·생명주기 훅
│   ├── Viewport/                   # Canvas·카메라·공유 3D 모델·인스턴싱
│   ├── Header/
│   ├── Hud/
│   │   ├── _components/Panel.tsx   # HUD 공통 패널
│   │   ├── asset/                 # 에셋·배치
│   │   ├── equipment/
│   │   │   ├── _components/EquipmentCard.tsx # 선택·더블클릭·키보드 공통 처리
│   │   │   ├── robot/              # RobotCard·로봇 상태 목록
│   │   │   ├── amr/                # AMRCard·AMR 상태 목록·상태 문구
│   │   │   ├── pallet/             # PalletCard·팔레트 상태 목록
│   │   │   └── details/            # 더블클릭한 장비의 상세 화면
│   │   ├── object/                # 오브젝트 속성
│   │   ├── dashboard/             # 대시보드
│   │   └── simulation/            # 재생·속도·통계
│   ├── amr/                       # AMR 배차·교통 제어
│   ├── conveyor/                  # 컨베이어 모델 형상
│   └── robots/                    # 공유 로봇 제어
├── legacy/                        # 기능 테스트용 기존 데모·전용 시뮬레이션 엔진
│   ├── robot/RobotDemo.tsx
│   ├── conveyor/ConveyorDemo.tsx
│   ├── amr/AMRDemo.tsx
│   └── Hud/                       # 데모 선택·상태·관절·패킹 디버그 UI
├── constants/simulatorLayout.ts   # 공장 배치 기본값·장비 설정
├── stores/                        # 배치·시뮬레이션·HUD 공유 상태
├── types/
├── utils/                         # 공유 도메인 계산
├── components/                    # 공용 UI
└── assets/models/                 # 원본 GLB 모델
```

기본 장면은 `sceneMode: "simulator"`입니다. `useSimulationStore.setSceneMode()`의 `robot`, `conveyor`, `amr` 값은 레거시 기능 검증용으로 유지하며 해당 데모는 선택 시 지연 로드합니다. 레거시 전용 UI는 `src/legacy/Hud`에서 관리합니다. 실제 시뮬레이터가 사용하는 모델·제어·계산 코드는 공용 기능으로 유지합니다.

### 코드 배치 기준

- **공용 UI**는 `components`, **기능별 패널**은 `features/Hud`에 둡니다. 3D 장비 모델은 `features/Viewport/models`에 둡니다.
- **모델에만 필요한 코드**는 해당 모델 가까이에 둡니다. 팔레트는 `models/Pallet` 안에 표시 컴포넌트, 모델 생성 함수, 자체 동작 컨트롤러를 함께 관리합니다.
- **여러 장비의 상호작용**은 `FactorySimulator`가 조정합니다. 로봇 작업 배정, 완성 팔레트 큐, AMR 운반 연결 등이 여기에 해당합니다. 경로 탐색 같은 계산은 `utils`를 사용합니다.
- **데모**는 모델·시뮬레이터·상태 보고를 연결하는 장면 구성 코드입니다. 모델 정의나 HUD 구현은 각 담당 폴더에서 가져옵니다.
- **공유 상태**는 Zustand 스토어에서 관리합니다. 프레임마다 바뀌는 Three.js 좌표와 관절 애니메이션은 모델·컨트롤러에서 처리하고, UI에 필요한 통계와 상태를 스토어에 전달합니다.

### 주요 코드의 역할과 연결

- SIMULATION의 `SideBar.tsx`는 Edit(에셋 배치) / Play(시뮬레이터 제어)를 전환합니다. `workspace/WorkspacePanel.tsx`는 왼쪽 패널, Header의 `InspectorTabs.tsx`와 `inspector/InspectorPanel.tsx`는 오른쪽 Equipments / Details / Dashboard를 관리합니다. Details는 선택 설비의 상태와 설정을 표시하며, 설비 더블클릭으로 진입하고 뒤로 가면 Equipments로 돌아갑니다. 패널 표시 상태는 `useHudStore`, 편집 상태는 `useSceneStore.editing`, 실행 상태는 `useSimulationStore.running`에서 각각 관리하므로 패널을 닫거나 탭을 전환해도 실행은 유지됩니다. MONITORING에서는 Edit/Play를 숨기고 공통 정보 탭만 표시합니다.

- [App.tsx](src/App.tsx)는 전체 화면 Viewport와 그 위의 [Hud](src/features/Hud/index.tsx)를 배치합니다. HUD는 flex 세로 구조로 Header는 `h-14 shrink-0`, 본문은 `flex-1 min-h-0`로 나눕니다. 패널 열은 남은 높이 안에서 스크롤하며 calc()로 높이를 빼지 않습니다. 헤더와 패널만 포인터 입력을 받고 빈 영역은 3D 장면으로 전달합니다.
- [Pallet/index.tsx](src/features/Viewport/models/Pallet/index.tsx)는 팔레트를 표시합니다. [PalletController.ts](src/features/Viewport/models/Pallet/PalletController.ts)는 슬롯 예약, 박스 부착, 적재 완료, 출고 잠금, 빈 팔레트 교체를 담당합니다. 로봇과 AMR은 `FactorySimulator`를 통해 이 동작과 팔레트 그룹을 사용합니다.
- [EditableEquipment.tsx](src/features/simulator/editor/EditableEquipment.tsx)는 실제 장비 모델을 받는 편집용 래퍼입니다. 선택 이벤트와 이동·회전 조작을 붙이며, 모델 자체를 정의하지 않습니다.
- [AMR.tsx](src/features/Viewport/models/AMR.tsx)는 AMR 모델과 월드 좌표의 경로 선을 함께 표시합니다. 이동과 운반은 `PalletDispatchController`, 차량 간 양보·우회는 `AMRTrafficController`가 처리합니다.
- [SimulationPanel.tsx](src/features/Hud/simulation/SimulationPanel.tsx)는 하위 패널을 조립합니다. 각 하위 컴포넌트가 필요한 Zustand 값만 구독합니다. 상태 영역은 현재 기본 숨김이며, `<SimulationPanel showStatus />`로 표시할 수 있습니다.
- 로봇 동작의 공통 계약은 [RobotController.ts](src/interface/RobotController.ts), 흡착 로봇 구현은 [SuctionRobotController.ts](src/features/robots/SuctionRobotController.ts)에 있습니다.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

## Palletizing demo

Production uses robot.glb with a fixed robot root, a spline conveyor, a
1.1×1.1m T11 pallet centred at X=-0.7m, and 0.22×0.2×0.275m boxes.
FixedLayerPacker fills 20 slots per layer, farthest from the robot first,
then repeats the same order in the next layer. A blocked slot is not skipped.
The 5m stack limit is a packing limit, not a guarantee of physical robot reach.

### Motion planning

- robotKinematics.ts evaluates the actual GLB hierarchy in a separate FK model.
  Adaptive damped least squares, finite-difference Jacobians and multiple
  shoulder/elbow/roll starts solve position within 0.15mm. Numerical exploration
  never mutates the rendered robot.
- World downward orientation means the hand04-to-GripPoint shaft lies within
  a 5-degree cone around world -Y. It is not a local hand04 angle or a full
  world quaternion equality. Yaw is free. Transport does not impose this cone;
  final contact/release does. Intermediate high descent points can relax tilt
  when necessary, while the release pose must satisfy the cone.
- The planner checks endpoint collisions separately from swept joint paths.
  It tries short turns, collision-checked opposite turns for continuous joints,
  small Cartesian steps, then deterministic joint-space RRT detours.
  The hover pose is accepted only if it has a verified lowering route.
  Final lowering and withdrawal follow Cartesian steps; they do not fall back
  to arbitrary joint-space spins beside the load.
- Robot.tsx runs approach/contact, lift, transport, lower/release and withdrawal.
  A small contact offset is centred and collision-checked at pickup. Cargo
  is rigidly attached to GripPoint: local position and quaternion are fixed.
  Turning hand04 rotates both the gripper and the box together. There is no
  world-upright counter-rotation. Planning and animation use the same attachment.
  A release orientation mismatch is reported rather than snapping a substantially
  rotated box to the grid.
- Planning yields between numerical iterations and collision sample batches
  under a soft 4ms frame budget. This is not a hard real-time bound.
  Planning collision checks use denser angular samples and a small arm/pallet
  clearance; actual animation checks collisions again and rolls back on a hit.

hand01 uses Blender local X within -120..120 degrees. hand04 uses local X
within -100..80 degrees. hand00 and hand03 use Blender local Z (Three.js local Y).
hand00, hand02 and hand03 are continuous; hand03 is enabled. Limits and solver
settings live in constants.ts. The left-bottom panel provides local-angle sliders,
hand04 world Euler readings and the shaft's tilt from downward. Sliders pause
automatic motion and enforce joint limits, but allow collision inspection.
The right panel shows the real packing sequence and planning rejection reason.

Collision policy is unchanged: held cargo versus robot, placed cargo and pallet
is checked; arm versus other boxes and held cargo versus conveyor boxes is ignored.
Arm versus pallet and floor clearance remain checked. Only intended hand05
contact over the active box's top face is exempt. Failure messages distinguish
position search, downward-pose search, endpoint collision and route collision.
A search failure is not a proof that no geometric solution exists.

### Validation and limits

Run node scripts/verify-ik.mjs for the current production regression, or add
--packing-only for packing/kinematics/collision fixtures without moving pickups.
IK_FPS selects a simulated frame rate; IK_STREAM_TARGET and IK_STREAM_SECONDS
increase the target count and simulation duration. --legacy additionally runs
the historical differently-scaled 10-box demo, which is not a passing regression
for the current robot model.

The new solver passes actual-GLB FK parity under a transformed parent, reachable
and unreachable numerical targets, continuous-joint limits, collision rollback,
packing, support, order and pallet exchange fixtures. The rigid-grasp regression sweeps hand04 from -100 to 80 degrees and verifies
an invariant wrist/box relative transform and absence of new hand04 penetration.
The previous world-upright transport model could create false wrist/box collisions;
its successful 3/5-transfer runs are historical and do not validate rigid transport.
With the current 0.22×0.2×0.275m footprint and rigid attachment, the continuous
regression currently stops at a carried-box/pallet descent collision. The remaining
placement-orientation planning is unresolved; a full-pallet run is not passing.
Actual collisions and fixed far-to-near slot order remain enforced.

### 코드 책임과 가독성

- 장면 진입 컴포넌트는 화면 조합과 전환을 맡고, 편집 UI는 `simulator/editor`, 실행 표시와 엔진 생명주기는 `simulator/runtime`에 둡니다.
- HUD는 패널 조합, 장비 상세, 종류별 상태 표시를 각각의 컴포넌트로 분리합니다. 한 기능에만 필요한 보조 파일은 해당 폴더에 둡니다.
- 상태 구독, 파생 값 계산, 이벤트 처리, 렌더링은 논리 단위로 묶고 단위 사이에는 빈 줄을 둡니다. JSX도 서로 다른 역할의 블록 사이에 빈 줄을 둡니다.

### 스캐너 검사

에셋에서 스캐너를 추가하고 컨베이어 위에 배치합니다. 모델의 `ScanPoint` 위치를 기준으로 박스 중심이 검사 평면을 통과할 때 판정하며, 스캐너 폭 밖이나 높이 밖의 박스는 검사하지 않습니다. 스캐너 속성에서 불량률을 0~100%로 설정합니다(기본 10%). 박스의 첫 판정은 이후 스캐너에서도 유지합니다.

`gradient` 재질은 `src/index.css`의 `--color-safe` 또는 `--color-fault`로 실제 시간 1초간 표시한 뒤 원래 색·발광색으로 복원합니다. 각 스캐너는 재질 사본을 소유하며, 정지·배속과 관계없이 표시 시간이 흐릅니다. 상세 화면에서 검사·통과·불량 개수를 확인할 수 있습니다. 판정은 표시와 집계 용도이며 불량 박스를 자동 배출하지 않습니다.

`npm run test:scanner`로 실제 GLB의 ScanPoint·재질, 색상 복원·격리, 판정률 경계, 중복 검사 방지와 고속 이송을 검증합니다. 장비 카드는 한 번 클릭하면 선택하고, 더블클릭 또는 Enter/Space로 상세 정보를 엽니다.

### 장비별 상세 화면

`EquipmentDetails`는 장비 종류별 상세 컴포넌트를 선택하는 역할만 맡습니다. `robot/RobotDetails`, `amr/AMRDetails`, `pallet/PalletDetails`, `conveyor/ConveyorDetails`, `scanner/ScannerDetails`, `dock/DockDetails`가 각각 자신의 데이터 조회와 설정 구성을 소유합니다. 상세 화면에서 편집기용 `ObjectPropertiesPanel`을 사용하지 않습니다.

이미지·이름·뒤로 가기와 배치 정보는 `details/_components/EquipmentDetailLayout`을 재사용합니다. 숫자 설정·속도·활성화 컨트롤만 공유하며, 각 장비는 필요한 컨트롤을 직접 조합합니다. 컨베이어는 연결과 생성 간격, 스캐너는 검사 결과와 불량률을 독립적으로 확장할 수 있습니다.

### 장비 정보와 실시간 지표

상세 화면은 이미지·장비명·상태 헤더, 기본 정보, 실시간 지표, 펼칠 수 있는 설정으로 구성합니다. 각 장비 상세는 공통 `DetailRows`에 자신의 항목만 전달하며, 가동률·적재율·통과율은 실제 값으로 게이지를 표시합니다.

`SceneEquipment.metadata`는 제조사·모델·일련번호·설치 위치·IP 주소를, `EquipmentSnapshot.telemetry[id]`는 연결 상태·지연 시간·온도·사이클 시간·소비 전력·프로그램·부품·동작 횟수를 선택적으로 담습니다. 기본 정보의 미등록 값은 `—`로 표시합니다. 실제 장비 통신은 별도 연동이 필요하며, 미연동 지표의 모의 값과 연결 상태에는 모의 표시를 붙입니다.

로봇 관절 각도는 실제 컨트롤러에서 로봇 ID별로 0.1초마다 읽습니다. 온도·전력 등 미연동 지표는 모의 값으로 표시하며 1초마다 갱신하고, 재생을 멈추면 유지합니다. 실제 telemetry가 있으면 우선 사용합니다. 제조사·모델 등 기본 정보는 임의로 생성하지 않습니다.

장비 Detail은 이미지·이름·상태 아래에 설정값을 바로 표시합니다. 뒤로 가면 설비 목록으로 복귀하며 실행 상태는 유지됩니다. 값 적용은 src/utils/equipment/applyEquipmentSettings.ts에서 관리합니다. 현재 시뮬레이션에서만 값을 적용하고 모니터링은 읽기 전용입니다. 실제 설비 명령 전송과 응답 처리는 아직 연결하지 않았습니다.
