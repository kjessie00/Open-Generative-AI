# 기획·대본 공동 작업과 에이전트 요청 대기열

## 결론

첫 작업 단계를 `기획·대본`으로 바꾸고, 사용자가 기획과 스크립트를 직접 편집·저장하거나 같은 화면에서 에이전트 요청을 남길 수 있게 했다. 요청은 실제 모델을 호출하지 않고 비공개 로컬 대기열에 저장되며, UI는 이를 `요청 저장됨 · 아직 실행 전`으로만 표시한다.

## 사용자 흐름

1. `기획·대본` 단계에서 제작 설정을 확인한다.
2. `1. 기획` 또는 `2. 스크립트` 내용을 직접 편집한다.
3. `직접 저장`으로 현재 기획과 대본 전체를 비공개 로컬 초안에 저장한다.
4. 필요한 경우 `무엇을 바꿀까요?`에 지시를 적고 `에이전트에게 요청`을 누른다.
5. 앱은 현재 초안을 먼저 저장한 뒤 그 버전에 결속된 요청을 로컬 대기열에 기록한다.
6. 앱을 종료했다가 다시 열어도 초안과 두 단계의 요청 대기 상태가 복원된다.

제작 설정은 compact 영역으로 분리했고, 명령 미리보기는 화면 하단의 접힌 영역으로 옮겼다. 상태 배지, 내부 요청 ID, 해시, 저장 경로, provider 상태 코드는 기본 UI에 표시하지 않는다.

## 실행 경계

- Renderer는 `window.filmPipeline.enqueuePlanningAgentRequest(...)`만 호출한다.
- Preload는 `film-pipeline:enqueue-planning-agent-request` 한 채널만 노출한다.
- Main process는 저장된 초안의 canonical revision을 다시 계산하고 renderer가 보낸 revision과 일치할 때만 요청을 저장한다.
- 입력은 `stage`, `instruction`, `expected_revision_sha256` 세 필드만 허용한다.
- 요청 레코드는 `queued_local_handoff`, `executed:false`, `model_called:false`를 고정한다.
- 경로, 명령, 모델 이름 같은 추가 renderer 입력은 거부한다.
- 같은 초안·단계·지시는 결정적 ID로 한 번만 저장된다.

저장 위치는 Electron `userData` 아래 `film-pipeline/drafts/canonical-project-bootstrap-v1/collaboration/queue/`이다. 초안·요청 파일은 `0600`, 관련 디렉터리는 `0700`이고, no-follow·exclusive temp·fsync·atomic rename 경계를 사용한다.

## 실제 검증

실제 기본 Electron entrypoint를 격리된 `userData`와 빈 제작 상위 폴더로 실행했다. happyVideoFactory의 기존 브리프와 스크립트를 읽어 작업대에서 직접 수정하고 저장한 뒤 기획·스크립트 요청을 각각 한 개씩 남겼다.

- 직접 수정한 브리프와 스크립트: 앱 완전 종료 후 exact 복원 PASS
- 요청 2개: `brief`, `script` 각 1개 복원 PASS
- 요청 상태: 두 레코드 모두 `queued_local_handoff`, `executed:false`, `model_called:false`
- UI: 두 단계 모두 `요청 저장됨 · 아직 실행 전`, 내부 ID·해시·원시 상태 코드 미노출
- 반응형: 320/768/1024/1440에서 horizontal overflow 0, form control 13개, 최소 높이 44px
- 저장 무결성: draft/request 파일 `0600`, draft/collaboration/queue 디렉터리 `0700`, metadata와 brief/script SHA-256 일치
- 제작 상위 폴더: 새 제작 폴더 0
- 외부 요청, console warning/error, runtime exception, failed load: 0
- 실제 생성, API key 사용, upload: 0
- 첫 실행과 재실행 모두 정상 종료, 강제 종료와 잔여 process group 0

실제 Electron 결과는 `/Users/jessiek/.codex/visualizations/2026/07/16/open-ga-planning-collab-e2e/result.json`에 있다. 실제 1440 캡처는 다음과 같다.

- `planning-collaboration-1440.png`: `c51e9b074d6382acf3fa0c981cbbe4149ca35dcd79d6e8281db1155ce775d2db`
- `script-collaboration-1440.png`: `5e920d58f1b24ff2c3c788628abf0eb07b32bfba9a98e68df85126b3af0bfe32`
- `planning-collaboration-restored-1440.png`: 첫 캡처와 byte-identical

캡처 증거 주의: 첫 실제 PASS 실행에서 Chromium이 반환한 PNG Buffer를 E2E 드라이버가 JSON으로 직렬화하는 결함이 있었다. PNG signature를 포함한 exact Buffer 배열을 원래 bytes로 복원했고 위 SHA-256을 재확인했다. 이후 같은 코드의 최종 기능 실행은 전체 PASS했지만 macOS Chromium compositor 재캡처가 간헐적으로 실패하여, 최종 result는 앞선 동일 코드 실제 실행의 보존된 PNG를 명시적으로 재사용한다.

## 자동 검증

- 집중 provider/security/renderer/workflow 계약: PASS
- 전체 순차 Node 회귀: `271/271 PASS`
- 실제 ffmpeg adapter preflight: PASS
- `npm run lint`: PASS
- `npm run build`: PASS, 59 modules
- `git diff --check`: PASS

## 현재 상태와 다음 경계

기술적으로 직접 편집·저장, 요청의 안전한 handoff 저장, 재실행 복원은 PASS다. 실제 에이전트 worker가 요청을 가져가 제안을 만들고 사용자가 비교·적용하는 기능은 아직 연결하지 않았다. 따라서 `에이전트에게 요청`은 현재 **요청 접수 완료**가 아니라 **로컬 handoff 저장 완료, 아직 실행 전**이다. 콘텐츠 품질과 Jessie의 최종 승인은 별도 상태다.
