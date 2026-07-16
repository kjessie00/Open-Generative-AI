# 새 프로젝트 최종 편집 준비

## 목적

4단계에서 사용자가 직접 고른 영상 구간을 장면 순서대로 묶어, 5단계의 로컬 최종 편집이 나중에 읽을 수 있는 비공개 입력으로 저장한다. 이 단계는 영상을 합치거나 완성본을 만드는 실행 단계가 아니다.

## 구현 계약

- 모든 승인 영상에 유효한 시작·끝 구간이 있을 때만 준비할 수 있다.
- Electron main이 현재 설계·이미지 계획·영상 계획·클립 선택 revision과 실제 MP4 경로·SHA-256·길이·크기를 다시 검증한다.
- `film_pipeline.new_project_final_stitch_handoff.v1`을 private `final_stitch/handoff.json`에 원자 저장한다.
- 디렉터리는 `0700`, 파일은 `0600`이며 renderer에는 경로·SHA·task/result 식별자와 private provenance를 노출하지 않는다.
- 저장 입력은 기존 로컬 roughcut adapter가 읽는 `film_pipeline.finishing_render_payload.v1`, `short-drama-room-selected-takes-v1`, `short-drama-room-beats-v1` 구조를 포함한다.
- Flow·Grok·Replicate·ByteDance 제공자 이름은 다른 제공자로 위장하지 않고 그대로 보존한다.
- 상위 선택이나 결과가 바뀌면 이전 handoff는 복원하지 않고 새 준비 상태로 전환한다.
- `executed`, `rendered`, `generation_executed`는 모두 `false`이며 실제 render/final/품질 승인을 주장하지 않는다.

## UI

- 5단계 첫 화면은 배지 없이 `최종 편집 준비`를 보여준다.
- 선택 개수, 총 길이, 장면 순서와 각 시작·끝 구간만 표시한다.
- `최종 편집 준비 저장` 뒤에는 `준비됨 · 아직 영상으로 합치지 않음`을 표시한다.
- 구간 선택이 덜 됐으면 `클립 선택 열기`로 4단계에 돌아간다.
- 기존 production 마감 화면은 `기존 제작 마감 결과` 아래에 접는다.

## 실제 검증

이전 단계에서 실제 1초 MP4와 함께 저장했던 격리 Electron userData를 별도 증거 폴더에 복제해 검증했다.

- 저장 전 화면에서 `선택 1개 · 총 0.6초`, `장면 영상 · 재회`, `0.2초 → 0.8초`를 확인했다.
- 실제 버튼으로 저장한 뒤 `준비됨 · 아직 영상으로 합치지 않음`을 확인했다.
- private handoff는 schema·장면 순서·구간을 보존했고 실제 제공자는 `grok`이었다.
- handoff 디렉터리 `0700`, 파일 `0600`, `executed=false`, `rendered=false`, `generation_executed=false`를 확인했다.
- final-stitch 폴더에는 `handoff.json`만 있었고 MP4 완성본이나 render 출력은 생성되지 않았다.
- 앱을 완전히 종료하고 같은 userData로 재실행한 뒤 같은 선택 수·길이·구간과 준비 완료 문구가 복원됐다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/new-project-final-stitch-handoff/01-ready.jpeg`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/new-project-final-stitch-handoff/02-staged.jpeg`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/new-project-final-stitch-handoff/03-relaunch-restored.jpeg`

## 자동 검증

- 변경 관련 집중 테스트: `67/67 PASS`
- 전체 Node 회귀 테스트: `359/359 PASS`
- 실제 local ffmpeg selected-range 회귀도 전체 suite 안에서 PASS
- `npm run lint`: PASS
- Vite build: `76 modules`, PASS
- `git diff --check`: PASS

## 경계와 다음 작업

이번 PASS는 실제 MP4 선택이 안전한 private 최종 편집 입력으로 저장·복원된 기술 검증이다. 영상 합치기, fresh ffprobe, 결과물 품질, Jessie의 최종 승인은 아직 수행하거나 주장하지 않는다. 다음 제품 slice는 이 handoff를 명시적인 새 프로젝트 finishing plan/execute API에 연결해 private roughcut을 만들고, 재실행 복원과 fresh probe를 검증하는 것이다. 32 MiB를 넘는 영상의 streaming preview도 별도 과제로 남는다.
