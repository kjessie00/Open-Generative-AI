# 새 프로젝트 최종 영상 복원 성능

## 목적

새 프로젝트 검토용 합본을 재실행할 때 상태 확인과 미리보기 확인이 같은 영상을 두 번 전체 검증하던 경로를 하나로 합친다. 신뢰 검사를 줄이지 않으면서 작업대는 느린 최종 영상 확인을 기다리지 않고 먼저 열리고, 확인 중에는 잘못된 생성 버튼을 보여주지 않는다.

## 수정 전 기준

- 같은 비공개 합본에서 직접 측정한 상태 확인은 `6,264ms`, 이어진 미리보기 확인은 `5,740ms`로 합계 `12,004ms`였다.
- 독립 측정은 cold 복원 `27,990ms`, warm 복원 `12,979ms`였다.
- 기존 경로는 상태 IPC와 미리보기 IPC가 각각 런타임과 영상을 다시 확인해 `runtime.inspect`와 `runtime.probe`가 모두 두 번 실행됐다.

## 구현 계약

- main-owned final-render `get`은 한 번의 검증 결과에서 공개 상태와 pathless inline MP4 preview를 함께 반환한다.
- 이미 게시된 current를 한 번 읽을 때 `runtime.inspect`와 `runtime.probe`는 각각 `2 → 1`회가 된다.
- fresh probe 뒤 preview 바이트를 안정적으로 다시 읽어 앞서 검증한 output SHA-256과 size를 모두 재비교한다. probe 직후 파일이 바뀌면 상태를 `blocked`로 내리고 preview 바이트를 노출하지 않는 TOCTOU fail-closed 계약이다.
- inline preview 상한은 기존과 같은 `32 MiB`다. 이를 넘는 영상은 준비 상태만 반환하고 base64를 만들지 않는다.
- renderer는 inline preview를 Blob object URL로 바꾼 직후 원본 base64 필드를 상태에서 제거한다.
- inline 필드가 없는 구 bridge와 execute 직후 응답은 기존 pathless preview IPC fallback을 유지한다.
- 초기 restore, 사용자 refresh, execute, review decision은 같은 요청 epoch를 사용한다. 더 늦게 시작된 요청이 있으면 이전 초기·refresh 응답과 preview가 최신 상태를 덮지 못한다.
- renderer는 초기 final get을 다른 상태 읽기와 병렬로 시작하되 기다리지 않고 나머지 작업대를 먼저 그린다. 확인 중 문구는 `검토용 영상을 확인하는 중입니다.`이고 `검토용 영상 만들기` 버튼은 숨긴다.

## 수정 후 실제 성능과 Electron 확인

- 같은 격리 userData에서 provider `get + inline preview` 직접 측정은 `5,600ms`였다.
- 반환된 MP4 preview는 `3,478 bytes`, `video/mp4`, pathless base64였고 별도 preview IPC는 호출하지 않았다. 이 `5,600ms`가 provider 경로의 정확한 비교 성능값이다.
- 실제 Electron은 `app.setPath('userData', exactIsolatedUserData)`로 같은 격리 상태를 사용했다.
- 재실행 직후 최종 패널은 pending 문구만 표시하고 생성 CTA를 표시하지 않았다.
- 확인 완료 뒤 실제 `0.6초` native video와 `다시 만들기로 선택됨`, `이 영상 사용`, `다시 만들기`, `결과 검토 열기`가 복원됐다.
- 도구 polling에서 home 화면을 처음 캡처한 시점은 launch 후 상한 `16,421ms`, loaded 최종 화면 캡처는 `17,484ms`였다. 이는 poll 간격, 화면 캡처, 전체 앱 초기화를 포함한 도구 관측 상한이며 provider 성능값으로 사용하지 않는다.

실제 화면 증거:

- pending: `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/final-restore-performance/actual-Kr15ce/01-pending.jpeg`
- loaded: `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/final-restore-performance/actual-Kr15ce/02-loaded.jpeg`
- 시각 기준선: `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/final-review-decision/07-responsive-native-zoom.png`

## 화면 충실도 장부

기준선과 pending·loaded 화면을 같은 데스크톱 조건에서 비교했다.

1. 왼쪽 `1 기획·대본`부터 `5 마무리`까지 5단계 rail과 활성 단계 계층을 그대로 유지했다.
2. loaded 화면의 검토용 최종 영상, 검은 media frame, native 재생 컨트롤을 그대로 유지했다.
3. `다시 만들기로 선택됨`, `이 영상 사용`, `다시 만들기`, `결과 검토 열기`의 상태·행동 문구와 순서를 유지했다.
4. 1228×768 데스크톱에서 영상과 결정 영역이 기존과 같은 2열로 보이고 모든 핵심 조작이 첫 화면에 남는다.
5. 새 badge, 영문 내부 상태, private path, 해시, token을 화면에 추가하지 않았다.
6. loaded copy, 타이포그래피, 색, 테두리, 간격은 기준선과 같고 성능 변경으로 인한 의도적 시각 편차는 없다.

## 자동·독립 검증

- 변경 집중 테스트: `53/53 PASS`
- root 전체 Node 회귀: `375/375 PASS`
- lint: PASS
- Vite build: PASS
- `git diff --check`: PASS
- 독립 focused/security 검증: `61/61 PASS`
- 최종 독립 판정: P0/P1/P2 없음
- 반례는 probe 뒤 output 변조 fail-closed, 느린 초기 응답의 최신 refresh 덮어쓰기 차단, inline preview 사용 시 별도 preview IPC 0회를 포함한다.

## 경계와 다음 작업

이번 PASS는 로컬 private 합본의 복원 시간과 작업대 가용성, pathless preview 신뢰 계약을 증명한다. API, provider live generation, 외부 업로드는 실행하지 않았고 영상 내용 품질, Jessie의 품질 승인, canonical delivery 승격을 주장하지 않는다. 다음 후보는 `32 MiB` 초과 영상을 위한 pathless streaming preview 또는 다음 미완료 로컬 pipeline gap이다. 광범위한 Cinematic Pipeline Studio 목표는 아직 완료되지 않았다.
