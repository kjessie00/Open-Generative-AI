# DST 다중 결과 한눈에 선택

## 목적

하나의 DST 완료 묶음에 든 여러 이미지를 번호 선택으로 한 장씩 보지 않고, 새 프로젝트 이미지 작업에서 동시에 비교한 뒤 정확히 한 장만 현재 결과로 연결한다. 후보 선택과 검토 보드의 사람 품질 결정은 계속 별도 단계다.

## 구현 계약

- 기존 indexed pathless IPC를 그대로 사용해 선택한 묶음의 `1..12` 이미지를 동시에 gallery로 불러온다. renderer에는 경로·파일명·해시를 노출하지 않는다.
- 사용자가 고른 정확한 sibling의 `image_index`만 기존 main-owned 연결 경로로 보낸다.
- `작업 진행 → 결과 확인`의 `이번 결과` deep-link는 해당 묶음을 열고, 이미지 번호가 있으면 같은 후보를 먼저 선택한다.
- 일부 미리보기만 실패해도 정상 sibling은 남기고, 실패한 결과만 선택할 수 없게 한다.
- 같은 묶음의 중복 로드는 single-flight로 합치며, 묶음 변경·새로고침 뒤 늦게 도착한 응답은 최신 gallery를 덮지 못한다.
- connector가 열린 이미지 작업 카드는 전체 폭을 사용해 1~3열 비교가 가능하다. 새 badge나 별도 preload/client IPC는 추가하지 않았다.

## 실제 Electron 검증

- 격리 fixture의 서로 다른 실제 PNG 3장(각 `360×640`)을 한 화면에서 동시에 비교했다.
- 이미지 2를 선택해 연결한 뒤 검토 보드가 `확인 필요`로 받은 것을 확인하고 `이 결과 사용`으로 저장했다.
- Electron을 완전히 종료하고 새 프로세스로 실행한 뒤 이미지 2와 `사용하기로 확인함` 결정이 복원됐다.
- `result.json`은 `selected_image_index=2`, `review_decision=use`, private `0700/0600`, 외부·모델·생성·provider 호출 `0`을 확인한다.
- DST source inventory의 전후 SHA-256은 모두 `177e3bc917f7056befae126f4c9c05f7cabf83f0ea8177016ea9eceac614b974`로 같았다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/17/dst-multi-result-selection-20260717T012755KST/`
- `/Users/jessiek/.codex/visualizations/2026/07/17/dst-multi-result-selection-20260717T012755KST/result.json`

## 검증과 경계

- 변경 집중·독립 테스트: `67 PASS`
- 전체 순차 Node 회귀: `364/364 PASS`
- lint: PASS
- Vite build: PASS, `77 modules`
- `git diff --check`: PASS
- 최종 독립 판정: P0/P1/P2 없음

로컬 DST 다중 결과 비교·선택은 완료됐다. 하지만 `dst image`에는 no-submit 모드가 없으므로 live DST 생성 실행은 여전히 차단 상태다. 실제 생성물의 창작 품질과 Jessie 승인은 별도이며, 다음 큰 로컬 gap은 Flow의 정확한 `0 또는 2` 참조 계약과 비공개 runtime/result staging이다.
