# Replicate 요청-결과 동일성 계약

## 한 줄 결론

Replicate 자동 실행 완료는 이제 `어떤 요청을 보냈는지`와 `어떤 prediction 결과가 돌아왔는지`가 정확히 연결될 때만 작업대에 결과로 표시된다. 예전 v1 영수증은 수동 가져오기에는 계속 보이지만 자동 실행 완료 근거로는 쓰지 않는다.

## 사용자 흐름

1. 작업대가 실행 run, 영상 task, 비공개 Replicate 요청, 출력 claim을 준비한다.
2. 외부 실행자는 Replicate prediction ID 폴더에 `result.mp4`와 v2 `receipt.json`을 함께 둔다.
3. 완료 영수증을 받을 때 Electron main이 현재 로컬 파일에서 요청과 claim을 다시 계산한다.
4. 아래 네 값과 locator의 prediction ID·영상 해시가 모두 맞아야 `결과 도착`으로 연결한다.
5. 하나라도 다르면 기존 결과를 추측해서 붙이지 않고 오류로 남긴다.

renderer에는 run/task/request/claim hash, prediction ID, 로컬 경로가 전달되지 않는다. 사용자는 기존의 짧은 상태와 결과 미리보기만 본다.

## 외부 결과 v2

스키마는 `film_pipeline.external_video_result.v2`이고 Replicate 전용이다. `result_id`는 Replicate prediction ID다.

v1의 기존 필드에 다음 네 필드를 정확히 추가한다.

- `run_revision_sha256`: 실행 run revision
- `task_token`: 해당 영상 작업 token
- `request_revision_sha256`: 실제 Replicate 요청 명세 revision
- `output_claim_sha256`: `<task_token>.claim.json`의 정확한 파일 bytes SHA-256

v2 영수증은 추가 필드나 누락 필드를 허용하지 않는다. 자동 연결은 provider, prediction ID, `result.mp4` SHA-256, 위 네 binding을 모두 비교한다.

## 호환성과 실패 방식

- Replicate v2 + 정확한 binding: 자동 실행 완료 결과로 연결
- Replicate v1: 기존 수동 결과 가져오기와 일반 locator 조회는 유지
- Replicate v1을 자동 완료에 사용: `EXECUTION_REPLICATE_RESULT_BINDING_REQUIRED`
- run/task/request 불일치: `EXECUTION_REPLICATE_RESULT_REQUEST_MISMATCH`
- claim 불일치: `EXECUTION_REPLICATE_RESULT_CLAIM_MISMATCH`
- locator prediction ID 또는 영상 SHA 불일치: `EXECUTION_RESULT_LOCATOR_INVALID`
- 앱 재실행: 공개 candidate token은 바뀌지만 provider + prediction ID + 영상 SHA + binding으로 같은 결과를 다시 찾음
- claim이 사라진 기존 성공 기록: 성공 영수증은 숨기지 않고 `결과 도착 · 연결 확인 필요`로 유지

일반 실행 완료 영수증 `film_pipeline.new_project_execution_receipt.v1`의 필드 계약은 바꾸지 않았다.

## 실제 로컬 검증

다음 검증기는 기존 로컬 MP4를 격리 폴더에 복사하고 실제 `ffprobe`로 검사한다. 합성 v1/v2 provider 영수증으로 자동 연결 경계만 검증하며 네트워크, API token, 모델, 생성, 업로드를 호출하지 않는다.

```bash
node scripts/verify-replicate-request-result-identity.mjs <격리-증거-폴더> [로컬-mp4] [ffprobe]
```

검증 결과:

- 실제 로컬 MP4: 6,349,367 bytes
- 실제 SHA-256: `a685206f1e318fe12611c210ff411b3160b02608cf967c81233ba1e81db451ee`
- 실제 `ffprobe`: `/opt/homebrew/Cellar/ffmpeg/8.0.1_4/bin/ffprobe`
- v1 수동 조회 PASS / v1 자동 완료 차단 PASS
- v2 정확한 요청-결과 연결 PASS
- 앱 재실행 후 같은 결과 복원 PASS
- claim 삭제 후 성공 기록을 `연결 확인 필요`로 보존하고 claim 복원 후 다시 연결 PASS
- 공개 상태의 비공개 binding·prediction ID 비노출 PASS
- 외부 호출 0 / 모델 호출 0 / 생성 실행 0

실제 macOS Electron에서도 `3 생성 준비 → 작업 진행 → 결과 확인 → 영상 미리보기`를 직접 조작했다. 작업 목록은 `시작 전 2 · 진행 0 · 결과 1 · 문제 0`, 정확히 묶인 영상은 `결과 도착 · 연결 준비됨`으로 표시됐고, 연결창은 `이번 결과 · Replicate · 5.0초 · 1088×1920`을 선택해 실제 로컬 MP4 프레임을 표시했다. 비공개 binding, prediction ID, 해시와 경로는 화면에 나타나지 않았다.

- 격리 계약 검증: `replicate-request-result-identity/local-contract/result.json`
- 실제 Electron 검증: `replicate-request-result-identity/computer-use-result.json`
- 실제 요청 준비 문구 검증: `replicate-request-result-identity/computer-use-request-ready.json`
- 화면 증거: `replicate-request-result-identity/electron-video-preview.png`
- 대상 계약·UI 테스트: `71/71 PASS`
- 전체 Node 회귀: PASS
- lint PASS / Vite build PASS (`74 modules`)
- 최종 독립 읽기 전용 감사: P0/P1/P2 없이 PASS

스크립트는 `<격리-증거-폴더>/result.json`을 mode `0600`으로 새로 만든다. 기술 연결 PASS는 Replicate 실제 전송 성공, 실제 생성 성공, 영상 품질, Jessie의 최종 승인과 각각 별개다.
