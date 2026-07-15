# Flow·Grok 완료 영상 가져오기 체크포인트

## 목표

외부 도구에서 이미 완료된 영상을 앱의 저장된 영상 재작업 항목과 정확히 연결하고, 스토리보드에서 바로 비교·검토할 수 있게 한다. 새 영상 생성이나 외부 제출은 이 기능의 범위가 아니다.

## UI

- `스토리보드 > 순차 다시 만들기 계획` 안에 `완료 영상 가져오기`를 배치했다.
- 사용자는 `다시 만들기 항목`과 같은 공급자의 `완료된 영상`을 선택한다.
- 기본 화면에는 복잡한 상태 뱃지를 추가하지 않았다.
- 동작은 `영상 미리보기` → `가져오기 계획` → `이 영상 연결` 세 단계다.
- 연결된 영상은 기존 장면별 이미지·영상 검토 카드에 `미검토` 상태로 나타난다.

## main-owned 안전 경계

- renderer는 파일 경로나 해시를 전달하지 않고 불투명 후보 토큰만 사용한다.
- Electron main이 고정된 Flow/Grok 결과 위치를 제한적으로 탐색하고 실제 MP4 컨테이너, 영상 스트림, 재생 시간, 크기를 `ffprobe`로 확인한다.
- 저장된 `media_review_draft.json` 재작업 순서와 `media_attempts.jsonl` 원본 항목의 공급자·장면·시도 정보를 일치시킨 뒤에만 가져오기 계획을 만든다.
- 확인 시 영상을 production 내부 content-addressed 경로에 스트리밍 복사하고 원장에 새 `kind: video`, `generation_status: imported`, `review_status: unreviewed` 항목을 원자적으로 추가한다.
- 같은 결과를 다시 연결해도 파일이나 원장 행을 중복 생성하지 않는다.

## 실제 로컬 결과 검증

- Flow 정상 사례: `H1_ancient_campfire/result_1.mp4`
  - MP4/H.264, 1280×720, 10.006초, 2,673,934바이트
  - SHA-256 `a8109c7cf78114fcff7a0af72baaa161e9f40a9644bf4d675dff4608a74c5d11`
- Grok 정상 사례: `smoke_20260714T124945Z_14bdd16f.mp4`
  - MP4/H.264, 464×688, 6.042초, 4,417,147바이트
- Grok 거부 사례 2개는 확장자만 `.mp4`이고 실제 JPEG라 후보 목록에서 제외됐다.
- 실제 Flow H1 파일을 임시 production에 가져온 결과:
  - content-addressed 복사 파일과 원본 SHA-256 일치
  - 새 영상 시도 1건만 원장에 추가
  - 공급자 `flow`, 장면 `clip_a_001`, 시도 `2`, 검토 상태 `unreviewed`
  - 두 번째 동일 계획은 `already_current`로 판정되어 중복 쓰기 0건
  - 공개 workspace·plan·confirm 응답의 절대 경로 노출 0건

## 자동 검증

- 영상 importer 집중 테스트: 10/10 PASS
- IPC·renderer·기존 DST/재작업 회귀: 55/55 PASS
- 전체 Node 테스트: 203/203 PASS
- `npm run lint`: PASS
- `npm run build`: PASS, 59 modules
- `git diff --check`: PASS

## 실제 Electron E2E

- 실제 Flow H1 선택 → Blob 미리보기 → 가져오기 계획 → 영상 연결을 클릭으로 완료했다.
- Blob 미리보기와 가져온 장면 영상 모두 `readyState 4`, 10.005초, 1280×720로 재생 가능했다.
- 연결 뒤 `flow · 시도 2` 장면 카드가 나타났고, `다시 만들기 선택`과 검토 초안 저장이 동작했다.
- Electron을 완전히 종료하고 다시 실행한 뒤에도 가져온 영상 카드와 저장된 2개 재작업 선택이 복원됐다.
- 320px, 768px, 1024px, 1440px에서 가로 넘침과 잘린 조작부는 0개였다.
- renderer console error·exception·외부 요청은 0개였다.
- fixture에 의도적으로 둔 이전 missing 영상 경로의 `net::ERR_FILE_NOT_FOUND` 1건과 재실행 중 기존 video load 취소 `ERR_ABORTED` 1건은 새 importer 실패가 아니다. Chromium stderr의 `Unsupported pixel format: -1` 진단과 종료 시 macOS `SetApplicationIsDaemon paramErr`가 남아 strict whole-process stderr-clean은 BLOCK이다. 실제 H1 재생·복원 기능은 PASS다.
- 캡처:
  - `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-flow-video-import-e2e/flow-h1-imported-storyboard-1440.png`
  - `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-flow-video-import-e2e/flow-h1-restored-selected-storyboard-1440.png`

## 상태 구분

- 기존 Flow/Grok 결과 탐색: PASS
- 실제 Flow H1 미리보기·로컬 가져오기: PASS
- 앱에서 새 Flow/Grok 영상 생성: 실행하지 않음
- Replicate/ByteDance 완료 결과 가져오기 adapter: 아직 없음
- 가져온 영상의 화질·연출 품질: 미검토
- Jessie 최종 승인: 아직 없음
