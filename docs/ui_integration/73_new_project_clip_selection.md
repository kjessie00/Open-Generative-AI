# 새 프로젝트 클립 구간 선택

## 목적

`이 결과 사용`으로 승인한 새 프로젝트 영상을 4단계 `클립 선택`에 연결하고, 사용자가 실제 영상을 보면서 최종 편집에 사용할 시작·끝 구간을 직접 저장한다. 영상 파일 연결, 영상 품질 승인, 실제 사용 구간 선택을 서로 다른 상태로 유지한다.

## 구현 계약

- 현재 설계·이미지 계획·영상 계획과 정확히 일치하고 `use`로 승인된 영상만 선택 대상으로 연다.
- Electron main이 private result manifest와 MP4 전체 SHA-256, 길이, task/result identity를 다시 검증한다.
- 선택은 `film_pipeline.new_project_clip_selection.v1` 비공개 파일에 `0700/0600` 권한으로 원자 저장한다.
- 각 구간은 `0 <= 시작 < 끝 <= 실제 영상 길이`를 만족해야 하며 선택 이유가 필수다.
- 영상 전체는 자동으로 채택하지 않는다. `전체 구간`도 사용자가 누른 경우에만 값을 채운다.
- 부분 저장은 허용하지만 모든 승인 영상에 구간이 있어야 5단계 `마무리`로 이동한다.
- 상위 revision이나 result bytes가 바뀌면 기존 선택을 채택으로 사용하지 않고 새 빈 선택 상태로 연다.
- renderer에는 경로·SHA·private provenance를 노출하지 않으며 조회 IPC는 pathless이다.

## UI

- 4단계 첫 화면은 배지 없이 `새 프로젝트 클립 선택`과 `선택 N/M`만 보여준다.
- 각 장면에는 실제 영상, 시작·끝 초, 현재 재생 위치를 시작/끝으로 쓰는 버튼, 선택 이유, 확신도, `선택 지우기`, `전체 구간`을 둔다.
- 기존 production G3/QA 표는 `기존 제작 클립 QA` 아래에 접어 새 프로젝트 작업을 방해하지 않게 했다.
- 저장 후 `선택 N/N · 저장됨`을 표시한다.
- 메인 `지금 할 일`도 새 프로젝트 선택 상태를 사용한다. 재실행 후 모든 구간이 복원되면 `채택 N`과 `마무리`를 표시한다.

## 실제 검증

격리된 Electron userData와 1초 로컬 synthetic MP4 fixture를 사용했다.

- 실제 영상 컨트롤을 열고 시작 `0.2`, 끝 `0.8`, 이유 `표정과 동작이 가장 자연스러운 구간`, 확신도 `보통`을 저장했다.
- 저장 파일은 `0600`이었고 공개 UI에는 private 경로와 SHA가 없었다.
- 앱을 완전히 종료하고 재실행한 뒤 `선택 1/1 · 저장됨`, 두 숫자, 이유, 확신도가 그대로 복원됐다.
- 메인 화면은 재실행 직후 `채택 1`과 `선택한 구간으로 최종 편집을 준비하세요`를 표시했다.
- 실제 검증 중 메인 개요가 private 새 프로젝트 선택을 받지 않고 legacy state를 다시 계산하는 표시 오류를 발견해 같은 통합 상태를 전달하도록 수정했다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/new-project-clip-selection/01-saved-range.png`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/new-project-clip-selection/02-relaunch-restored.jpeg`

## 기획·스크립트 협업 회귀 확인

별도 깨끗한 Electron userData에서 1단계도 다시 확인했다.

- 기획과 스크립트가 각각 `직접 수정`과 `에이전트에게 요청` 두 열로 분리되어 보였다.
- 실제 한글 기획·스크립트를 입력하고 `직접 저장`하여 `직접 저장됨`과 저장된 본문을 확인했다.
- 에이전트 요청 입력란에 실제 한글 지시를 입력했고 `에이전트 작업 시작` 버튼이 활성 상태임을 확인했다.
- 이번 회귀 확인에서는 모델 호출을 실행하지 않았다. 실제 요청→수정안 비교→적용/보류 계약은 기존 collaboration 테스트와 문서 68의 격리 E2E 증거를 유지한다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/planning-script-collaboration/01-direct-and-agent-request.jpeg`

## 자동 검증

- 변경 관련 집중 테스트: `61/61 PASS`
- 전체 Node 회귀 테스트: `353/353 PASS`
- `npm run lint`: PASS
- Vite build: `75 modules`, PASS
- `git diff --check`: PASS

## 경계와 다음 작업

이번 PASS는 로컬 fixture의 기술 통합과 사용자의 구간 결정 저장을 검증한 것이다. 실제 DST·Flow·Grok·Replicate 생성, 실제 생성물 품질, Jessie의 최종 승인은 실행하거나 주장하지 않는다. 현재 blob 미리보기는 기존 32 MiB 상한을 유지하므로 그보다 큰 승인 영상은 main에서 검증·구간 저장할 수 있어도 UI 재생은 다음 streaming-preview 작업이 필요하다. 다음 제품 slice는 이 private 선택을 5단계 최종 편집 handoff 입력으로 변환하는 것이다.
