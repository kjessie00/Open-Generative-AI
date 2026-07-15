# 스토리보드 첫 영상 연결

## 목표

기존 영상 원장과 검토 초안이 없어도 스토리보드 장면에 Flow·Grok·Replicate·ByteDance의 완료 영상을 처음 연결한다. 연결한 영상은 같은 장면 카드에서 이미지와 함께 검토하고, 문제가 있는 결과만 다시 만들기로 선택한다.

## 계약

- production의 정식 `storyboard/storyboard.json`, `storyboard/clips.json`, `storyboard.json` 중 실제로 읽힌 한 파일만 장면 대상 권한으로 사용한다.
- 공개 workspace는 경로 없이 `target_token`, `kind`, `target_id`, `target_label`, `sequence`만 제공한다.
- 첫 연결과 다시 연결 요청은 각각 `{ candidateToken, initialTargetToken }`, `{ candidateToken, retryMediaId }`이며 두 방식을 섞거나 필드를 추가하면 차단한다.
- 첫 연결은 `attempt: 1`, `retry_of: ""`, 후보의 실제 provider, 한글 `target_label`, `review_status: "unreviewed"`로 기록한다.
- 계획 뒤 production root·스토리보드·원장·후보 파일이 바뀌면 확인 단계에서 중단한다.
- 영상은 내용 주소 경로에 mode `0600`으로 복사하고 원장은 잠금과 atomic append 경계에서 한 번만 공개한다.
- 이미 영상이 연결된 장면은 최초 대상 목록에서 즉시 숨긴다. 같은 내용의 재확인은 멱등이고 다른 내용의 중복 연결은 차단한다.

## UI

- 저장된 재작업 항목이 없어도 `첫 영상 연결`을 표시한다.
- 사용자는 `연결할 장면`과 `완료된 영상`만 고른다. 내부 대상 ID와 opaque token은 화면에 표시하지 않는다.
- 첫 연결에서는 모든 완료 영상 provider 후보를 보여주고, 다시 연결에서는 원래 provider와 같은 후보만 보여준다.
- 최초 대상과 재작업 대상이 모두 있을 때만 `처음 연결 / 다시 연결` 선택을 표시한다.
- DST 첫 이미지 연결이 열려 있어도 첫 영상 연결을 별도로 숨기지 않는다.
- 새 배지와 raw blocker 코드는 추가하지 않고, 모든 선택 조작부는 최소 44px를 유지한다.

## 실제 Electron 검증

시작 production에는 `brief.md`와 한 장면을 가진 `storyboard/storyboard.json`만 두었다. 실제 canonical Replicate receipt `replicate_a685206f1e318fe12611c210`의 `result.mp4`를 기본 Electron entrypoint에서 선택했다.

1. Blob 미리보기는 `readyState: 4`, 오류 없음, 5.041667초, 1088×1920으로 재생 준비됐다.
2. `비 오는 차 안의 첫 장면`에 `replicate · 시도 1` 카드가 생성됐다.
3. 원장은 정확히 1건이고 `attempt: 1`, `retry_of: ""`, `review_status: "unreviewed"`, `source_provenance: "provider_result_receipt_v1"`였다.
4. 원본과 CAS 파일은 6,349,367 bytes, SHA-256 `a685206f1e318fe12611c210ff411b3160b02608cf967c81233ba1e81db451ee`로 같고 CAS mode는 `0600`이었다.
5. 이 영상 한 개만 `다시 만들기`로 골라 실행하지 않은 retry queue 1개를 저장했다.
6. 연결 직후 최초 장면 선택은 0개로 줄었다.
7. Electron을 완전히 종료하고 새 프로세스로 다시 열자 같은 카드, 선택 상태, 5.041667초 영상이 복원됐고 최초 연결 대상은 다시 나타나지 않았다.
8. 320/768/1024/1440px에서 가로 넘침은 0, 영상 연결 조작부 최소 높이는 44px였다.
9. renderer 외부 요청·console 경고/오류·예외는 0이었다. Chromium stderr에는 기존 `Unsupported pixel format: -1` 진단이 남지만 실제 영상은 재실행에서도 `readyState: 4`, 오류 없음이었다.
10. 실제 영상 생성, API key 사용, 외부 업로드는 0건이었다.

Computer Use는 별도로 실제 `Cinematic Pipeline Studio` Electron 창과 저장된 production 제목을 화면으로 확인했다. macOS 접근성 트리는 새 항목을 주지 않아 클릭 검증은 CDP의 실제 renderer/preload/main 경로로 수행했다.

## 증거

- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-initial-video-e2e/first-run.json`
- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-initial-video-e2e/relaunch.json`
- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-initial-video-e2e/first-video-selected.png`
- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-initial-video-e2e/media_attempts.jsonl`
- `/Users/jessiek/.codex/visualizations/2026/07/15/open-ga-initial-video-e2e/media_review_draft.json`

## 현재 경계

- provider+renderer 집중 44/44, 전체 순차 266/266, 실제 ffmpeg 어댑터 check, lint, 59-module build, diff check, 실제 Electron 첫 연결·부분 재작업 선택·완전 재실행 복원은 PASS다.
- 실제 생성 provider에 새 요청을 제출하는 기능은 프로젝트 안전 계약에 따라 여전히 dry-run/완료 결과 연결 경계다.
- 가져온 영상의 파일·연결 상태는 검증했지만 영화적 품질과 Jessie의 최종 채택은 승인하지 않았다.
