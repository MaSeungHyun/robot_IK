## 폴더 규칙
- components: React UI 컴포넌트만 배치
- features/Viewport/index.tsx: 3D 뷰포트
- features/Viewport/models: Robot, Pallet, Box 모델
- features/Hud: ConveyorDemo, JointAnglesPanel
- stores: Zustand 상태관리
- utils: React에 의존하지 않는 계산 함수
- 없는 데이터나 불필요한 파일을 만들지 않는다.

## 코드 규칙
- 여러 공통적으로 쓰이는 경우 따로 utils나 domains에 따로 정의 후 export 후 import하여 사용한다.
- 코드는 단일 책임 원칙으로 하나의 기능을 하는 함수로 나눈다 이때, 네이밍을 명확하게 정의한다.
- 하나의 함수에서 연관되지 않은 코드의 경우 줄과 줄사이에 공백을 넣어 가독성을 높인다.

## 완료 조건
- 기존 사용자 변경을 보존한다.
- 빌드와 린트를 실행한다.
- 동작 변경 시 관련 테스트를 실행한다.
- 실패한 검사는 숨기지 않고 보고한다.