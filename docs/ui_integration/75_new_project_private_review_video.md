# 새 프로젝트 검토용 영상

## 목적

5단계에 저장한 새 프로젝트 최종 편집 입력을 로컬에서 실제로 이어 붙이고, 앱 안에서 바로 재생해 검토할 수 있게 한다. 결과는 새 프로젝트 전용 비공개 roughcut이며 기존 production 마감 결과나 canonical delivery로 승격하지 않는다.

## 구현 계약

- Electron main만 고정 happyVideoFactory adapter와 ffmpeg/ffprobe를 호출한다. renderer는 pathless `get → plan → execute → preview` IPC만 사용한다.
- 실행은 2분 TTL의 한 번만 쓰는 plan token과 정확한 `{ planToken, confirmed, projectId }` envelope를 요구한다.
- 실행 전후에 현재 handoff, 선택 구간, 원본 전체 SHA-256, 런타임 fingerprint를 다시 확인한다.
- 음성 트랙이 없는 선택 영상은 전용 staging 안에서만 임시 무음 AAC를 붙인다. 임시 파일은 성공·실패 모두 제거하고 원본은 바꾸지 않는다.
- 결과는 `<draft>/final_stitch/runs/<24hex>/` 아래 `roughcut.mp4`, `fresh_probe.json`, `receipt.json` 세 파일로만 저장한다. 디렉터리는 `0700`, 파일은 `0600`이다.
- 게시 중단으로 `current.json`이 없거나 이전 snapshot을 가리켜도, 현재 deterministic run의 파일·hash·probe를 실행 lock 안에서 모두 다시 검증한 경우에만 포인터를 복구한다. 변조·오래된 영수증·symlink 결과는 삭제하거나 신뢰하지 않고 차단한다.
- renderer에는 경로, SHA, task/result id, 실행 인자, 내부 오류 코드를 표시하지 않는다. 32 MiB 이하 결과만 bounded base64 preview로 전달한다.

## UI

- `최종 편집 준비 저장` 뒤에 `검토용 영상 만들기` 한 버튼만 표시한다.
- 완료 후 `검토용 영상 0.6초`와 기본 영상 컨트롤을 표시한다.
- 상태 뱃지는 추가하지 않았다.
- 기술 확인과 사람 품질 승인을 분리해 `파일과 재생 길이만 확인했습니다. 내용과 영상 품질은 아직 승인되지 않았습니다.`라고 표시한다.
- 기존 production 마감 결과는 계속 접힌 영역에 둔다.

## 실제 검증

격리된 Electron userData에서 이전 단계의 실제 1초 로컬 MP4와 `0.2초 → 0.8초` 선택을 사용했다. 앱 버튼으로 새 handoff를 저장한 뒤 `검토용 영상 만들기`를 실행했다.

- 실제 출력: 3,478바이트 MP4, `0.600000초`
- 영상: H.264 High, `yuv420p`, `720×1280`, 24fps
- 오디오: AAC 무음 트랙
- fresh probe: video/audio 모두 true, 길이 0.6초
- receipt: rendered/fresh probe true, quality approval false
- 원본 SHA-256: 실행 전후 `faa64a039dd579b487baccfdbf6d740d6dd76e67ca181cbeb468d85ddd842e43`
- 게시 후 staging, render lock, recovery temp 잔여: 0
- 앱 완전 종료·재실행 후 상태: `already_current`, preview ready, `검토용 영상 0.6초`와 native time scrubber 복원
- 외부 API, 유료 생성, provider submit, 브라우저 자동화, 업로드, canonical delivery 변경: 0

증거 userData와 실제 결과는 다음 격리 폴더에 있다.

`/Users/jessiek/.codex/visualizations/2026/07/16/019f6018-5d37-7321-834e-fd5040eb15b1/new-project-final-render/`

## 자동·독립 검증

- 변경 관련 집중 테스트: `57/57 PASS`
- 전체 Node 회귀: `368/368 PASS`
- 실제 새 프로젝트 ffmpeg: `1/1 PASS`
- lint: PASS
- Vite build: PASS, 76 modules
- `git diff --check`: PASS
- 독립 PROVE: P0/P1/P2 없음

독립 검증에서 포인터 게시 직전 종료의 두 경우를 실제로 재현했다. `current.json` 누락과 이전 snapshot 포인터 잔존 모두 수정 후 현재 결과로 복구됐고, live lock과 변조 결과는 계속 fail-closed였다.

## 경계와 다음 작업

이번 PASS는 로컬 선택 구간 조립, fresh probe, 앱 미리보기와 재실행 복원을 증명한다. 영상 내용·미학·연속성에 대한 사람 검토와 Jessie의 최종 승인은 아직 아니다. 32 MiB를 넘는 결과의 streaming preview, 실제 provider 생성, 실제 production finishing과 canonical delivery 승격은 별도 작업으로 남는다.
