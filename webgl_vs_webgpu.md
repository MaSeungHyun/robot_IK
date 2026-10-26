# WebGL vs WebGPU 렌더러 차이

옵션(렌더 품질 → 렌더러)에서 WebGPU를 켜면 three.js `WebGPURenderer`(three 0.186)로 그립니다. 기본값은 WebGL이며 WebGL 동작은 바뀌지 않았습니다.

상태 표기: **동일** = 결과가 같음 / **대체** = 다른 방식으로 비슷하게 구현 / **미지원** = WebGPU에서 사용 불가

| 기능 | WebGL | WebGPU | 상태 |
| --- | --- | --- | --- |
| Bloom / 후처리 (AMR 빛 번짐) | pmndrs `postprocessing` EffectComposer + Bloom | EffectComposer가 WebGL 전용이라 사용하지 않음. 옵션은 비활성화되고 "WebGPU에서는 지원되지 않음" 표시. `WebGPUFrame`이 직접 렌더 | 미지원 |
| ShaderMaterial (링크 흐름 리본, 드롭인 홀로그램, 선택 외곽선 hull) | GLSL ShaderMaterial | `nodeFallbacks.ts`의 TSL 포팅(같은 수식)으로 자동 교체. 스텐실/블렌딩 등 상태는 원본 재질 값 사용 | 대체 (동일 결과) |
| 그 밖의 GLSL ShaderMaterial | 정상 | 흰색으로 깨지지 않도록 보이지 않는 재질로 대체 | 미지원 |
| 바닥 그리드 | drei `Grid` (무한 그리드, 셰이더) | `GridHelper` 200m × 800칸, 같은 색. 유한 그리드이고 거리 페이드 없음 | 대체 |
| 선 / 외곽선 (drei Line, Edges, 경로, 점선) | three-stdlib `LineMaterial` | `Line2NodeMaterial`로 변환 (색·두께·점선·worldUnits 유지) | 대체 (동일 결과) |
| 선택 외곽선 | 스텐실 마스크 + 법선 방향으로 밀어낸 back-face hull, 8px | 같은 구조를 TSL로 포팅. 두께·스텐실 동작·색 동일 | 동일 |
| MSAA | 캔버스 AA 끔, EffectComposer가 멀티샘플 | 컴포저가 없으므로 캔버스 `antialias: true` | 대체 |
| 그림자 | PCF (`shadows="percentage"`) | WebGPU 그림자 맵 (PCF 계열). 가장자리 부드러움이 약간 다를 수 있음 | 동일 (미세 차이) |
| 추적 링 (TrackingGroundRing) | MeshBasicMaterial (가산 블렌딩) | 기본 재질이라 자동 변환 | 동일 |
| KTX2 텍스처 | KTX2Loader, 렌더러로 포맷 감지 | 같은 로더, `configureKTX2`가 WebGPURenderer로 다시 감지 | 동일 |
| 썸네일 생성 | 메인 렌더러에서 픽셀 읽기 | 동기 `readRenderTargetPixels`가 없어 별도 WebGL 렌더러로 생성 | 대체 |
| 이방성 필터 | `capabilities.getMaxAnisotropy()` | `renderer.getMaxAnisotropy()` | 동일 |
| 톤매핑 / 색공간 | 장면이 컴포저 렌더 타깃에 그려져 톤매핑 없음, 출력에서 sRGB 인코딩 | R3F 기본값(ACESFilmic)이 화면 전체에 적용되던 것을 `WebGPUFrame`에서 NoToneMapping으로 고정, sRGB 인코딩만 적용 | 동일 (픽셀 값 일치 확인) |

## 이번 수정 (경로·외곽선 맞춤)
- 외곽선 hull: 정점 단계에서 `normalView`를 쓸 수 없어 hull이 안 넓어지던 문제 → `transformNormalToView(normalLocal)`로 수정. 이제 WebGL과 같은 두께로 보임.
- 유니폼 갱신: 물체가 멈추면 색·시간·해상도 유니폼이 GPU에 다시 올라가지 않던 문제 → 갱신 표시(`webgpuRefreshNode`) 추가. 리본 흐름 애니메이션, 외곽선 색 변경이 바로 반영됨.
- 색: WebGPU에서만 ACES 톤매핑이 화면 전체에 걸려 외곽선·리본이 흐리게, 장면은 대비가 다르게 보이던 문제 → WebGPU도 톤매핑 없음으로 맞춤. 외곽선(22,240,248), 리본, 바닥·벽 픽셀 값이 WebGL과 같음.

## 폴백 규칙
1. 옵션이 꺼져 있으면 항상 WebGL.
2. `navigator.gpu`가 없거나 GPU adapter가 없으면 WebGL로 실행하고 "WebGPU를 사용할 수 없어 WebGL로 실행 중" 표시.
3. 초기화 실패 또는 three가 WebGL2 백엔드를 고른 경우에도 새 캔버스로 WebGL 재마운트. 옵션을 다시 켤 때까지 WebGL 유지.
4. WebGPU 렌더 중 오류는 콘솔에 한 번만 기록.

## 성능 참고
- WebGPU는 후처리 패스(Bloom, 컴포저 MSAA)가 없어 GPU 부하가 더 낮은 편.
- 첫 프레임에 노드 재질 컴파일이 있어 처음 전환 시 잠깐 끊길 수 있음.
- 무한 그리드 대신 GridHelper(선 약 1,600개) 사용.
- 앱은 필요할 때만 렌더(on-demand)하는 방식이 두 렌더러 모두 같음.