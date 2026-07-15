# 새 프로젝트 통합 결과 검토 보드

## 해결한 단절

새 프로젝트의 연결된 이미지와 영상은 개별 `이미지 작업`, `영상 작업` 카드에서는 보였지만, `스토리보드`의 결과 검토는 기존 제작 폴더의 `media_attempts.jsonl`만 읽었다. 따라서 새 프로젝트에서 인물·장소 시트와 장면 이미지·영상을 모두 연결해도 한 화면에서 비교하고 다시 만들 항목을 고를 수 없었다.

이 변경은 새 IPC나 별도 저장소 없이 기존 새 프로젝트 상태와 재작업 저장 콜백을 스토리보드에 연결한다.

## 화면 구성

- `새 프로젝트 결과 검토`
- `전체 / 검토할 결과 / 다시 만들기` 필터
- `인물 기준`: 연결된 캐릭터 시트
- `장소 기준`: 연결된 장소 시트
- 장면 순서별 `장면 이미지 | 장면 영상`
- 결과가 있는 카드의 `다시 만들기 / 선택 해제`
- 해당 이미지·영상 작업 카드로 돌아가는 `작업 열기`
- 기존 제작 폴더 결과는 기본적으로 접힌 `기존 제작 결과`

검토 썸네일은 원본 9:16 내용을 `object-fit`으로 보존하면서 비교 카드 높이는 16:10으로 제한했다. 원본 파일이나 저장 결과는 변경하지 않는다. 상태 배지, provider 코드, 내부 토큰·경로·해시·명령도 추가하지 않았다.

## 상태와 안전 경계

- 이미지 재작업 선택은 기존 `saveNewProjectImageRetrySelection` 경로를 재사용한다.
- 영상 재작업 선택은 기존 `saveNewProjectVideoRetrySelection` 경로를 재사용한다.
- 선택은 design/image/video revision에 묶여 Electron main의 기존 검증을 그대로 통과한다.
- renderer가 받는 pathless image/video preview만 사용한다.
- `작업 열기`는 기존 작업대 탐색 콜백을 재사용한다.
- 영상의 `결과 검토로 이동`은 더 이상 기존 QA로 빠지지 않고 통합 스토리보드로 이동한다.

## 실제 검증

격리된 실제 Electron userData에 다음을 저장했다.

- 인물 시트 이미지 1개
- 장소 시트 이미지 1개
- 장면 이미지 1개
- 장면 영상 1개

이미지는 로컬 ffmpeg로 만든 색상 fixture, 영상은 로컬 ffmpeg로 만든 1초 MP4다. provider/API/browser/account는 호출하지 않았다.

Computer Use로 다음을 직접 확인했다.

1. 인물·장소 기준과 장면 이미지·영상이 한 스토리보드에 나타난다.
2. 장면 영상이 실제로 재생되고 1초까지 진행한다.
3. 영상 하나만 `다시 만들기`로 선택된다.
4. `다시 만들기` 필터에는 그 영상만 남는다.
5. 다른 단계로 이동했다 돌아와도 선택이 유지된다.
6. 직접 설계 저장과 설계 에이전트 요청이 같은 화면에 유지된다.
7. 화면에 내부 토큰·경로·명령·provider blocker가 보이지 않는다.
8. `검토할 결과` 필터에서 항목을 두 번 연속 `다시 만들기`로 골라도 필터가 유지되고, 선택한 카드만 즉시 목록에서 빠진다.

증거:

- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/new-project-review-board-e2e/result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/new-project-review-board-e2e/computer-use-result.json`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/new-project-review-board-e2e/desktop-reference-sheets.jpeg`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/new-project-review-board-e2e/desktop-storyboard-review.jpeg`
- `/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/new-project-review-board-filter-e2e/computer-use-filter-result.json`

자동 검증은 렌더러 통합 테스트 `34/34`, 전체 Node 테스트 `306/306`, lint, 74-module Vite build, 스크립트 구문 검사와 `git diff --check`를 통과했다. 독립 감사에서 처음 발견한 필터 초기화 P2는 필터 상태를 `PipelineStudio`에 보존하고, 전체 재렌더 뒤에도 선택 필터가 유지되는 통합 테스트와 실제 Electron 연속 선택으로 수정 확인했다. 수정 후 독립 재감사는 남은 P0/P1/P2 없이 PASS했다.

이 검증은 결과 연결·검토·재작업 선택의 기술 동작을 증명한다. 실제 생성 제공자 실행, 생성물의 창작 품질, Jessie의 최종 승인은 별도다.
